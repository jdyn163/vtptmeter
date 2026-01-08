import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";

type Reading = {
  room: string;
  date: string;
  dien: number;
  nuoc: number;
  id: number;
  note?: string;
};

type CacheEnvelope<T> = { savedAt: number; data: T };

function getPinForWrite(): string {
  if (typeof window === "undefined") return "";
  const key = "vtpt_pin";
  const current = (sessionStorage.getItem(key) || "").trim();
  if (current) return current;

  // If they left it blank on first open, ask again only when trying to save.
  const entered =
    window.prompt("Enter VTPT PIN to save changes:")?.trim() || "";
  if (entered) sessionStorage.setItem(key, entered);
  return entered;
}

function formatDateShort(d: Date) {
  return d.toLocaleDateString();
}

function formatDateTime(d: Date) {
  return d.toLocaleString();
}

function monthKeyISO(iso: string) {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function upsertMonthlyHistory(list: Reading[], reading: Reading, max = 24) {
  const next = Array.isArray(list) ? [...list] : [];

  const key = monthKeyISO(reading.date);
  const idx = next.findIndex((r) => monthKeyISO(r.date) === key);

  if (idx >= 0) next[idx] = reading;
  else next.unshift(reading);

  next.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return next.slice(0, max);
}

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function latestKey(room: string) {
  return `vtpt_room_latest:${room}`;
}

function historyKey(room: string) {
  return `vtpt_room_history:${room}`;
}

function houseLatestKey(house: string) {
  return `vtpt_house_latest:${house}`;
}

function houseHistoryKey(house: string) {
  return `vtpt_house_history:${house}`;
}

function readCachedLatest(room: string): CacheEnvelope<Reading> | null {
  if (typeof window === "undefined") return null;
  return safeJsonParse<CacheEnvelope<Reading>>(
    localStorage.getItem(latestKey(room))
  );
}

function readCachedHistory(room: string): CacheEnvelope<Reading[]> | null {
  if (typeof window === "undefined") return null;
  return safeJsonParse<CacheEnvelope<Reading[]>>(
    localStorage.getItem(historyKey(room))
  );
}

function writeCachedLatest(room: string, reading: Reading) {
  if (typeof window === "undefined") return;
  const env: CacheEnvelope<Reading> = { savedAt: Date.now(), data: reading };
  localStorage.setItem(latestKey(room), JSON.stringify(env));
}

function writeCachedHistory(room: string, list: Reading[]) {
  if (typeof window === "undefined") return;
  const env: CacheEnvelope<Reading[]> = { savedAt: Date.now(), data: list };
  localStorage.setItem(historyKey(room), JSON.stringify(env));
}

function upsertHouseLatestCache(house: string, reading: Reading) {
  if (typeof window === "undefined") return;
  const key = houseLatestKey(house);
  const cached = safeJsonParse<CacheEnvelope<Record<string, Reading>>>(
    localStorage.getItem(key)
  );

  const data: Record<string, Reading> = cached?.data || {};
  data[reading.room] = reading;

  const env: CacheEnvelope<Record<string, Reading>> = {
    savedAt: Date.now(),
    data,
  };
  localStorage.setItem(key, JSON.stringify(env));
}

function upsertHouseHistoryCache(house: string, reading: Reading, max = 24) {
  if (typeof window === "undefined") return;
  const key = houseHistoryKey(house);
  const cached = safeJsonParse<CacheEnvelope<Record<string, Reading[]>>>(
    localStorage.getItem(key)
  );

  const data: Record<string, Reading[]> = cached?.data || {};
  const prev = Array.isArray(data[reading.room]) ? data[reading.room] : [];

  // monthly upsert (replace same month instead of new row)
  data[reading.room] = upsertMonthlyHistory(prev, reading, max);

  const env: CacheEnvelope<Record<string, Reading[]>> = {
    savedAt: Date.now(),
    data,
  };
  localStorage.setItem(key, JSON.stringify(env));
}

function filterAndTrim(list: Reading[], max = 24) {
  const filtered = (Array.isArray(list) ? list : []).filter(
    (r) => r && typeof r.date === "string"
  );

  // keep sorted by date desc (nice + stable)
  filtered.sort((a, b) => {
    const da = new Date(a.date).getTime();
    const db = new Date(b.date).getTime();
    if (isNaN(da) && isNaN(db)) return 0;
    if (isNaN(da)) return 1;
    if (isNaN(db)) return -1;
    return db - da;
  });

  return filtered.slice(0, max);
}

export default function RoomPage() {
  const router = useRouter();
  const room = String(router.query.room || "").trim();
  const house =
    typeof router.query.house === "string" ? router.query.house : undefined;

  const [latest, setLatest] = useState<Reading | null>(null);
  const [history, setHistory] = useState<Reading[]>([]);
  const [loading, setLoading] = useState(false);

  const [showSheet, setShowSheet] = useState(false);
  const [dienInput, setDienInput] = useState("");
  const [nuocInput, setNuocInput] = useState("");
  const [noteInput, setNoteInput] = useState("");

  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [tab, setTab] = useState<"dien" | "nuoc">("dien");

  async function backgroundRefreshIfStale() {
    if (!room) return;
    const cachedLatest = readCachedLatest(room);
    const cachedHistory = readCachedHistory(room);

    if (cachedLatest?.data) setLatest(cachedLatest.data);
    if (cachedHistory?.data) setHistory(filterAndTrim(cachedHistory.data, 24));

    const now = Date.now();
    const latestStale =
      !cachedLatest?.savedAt || now - cachedLatest.savedAt > 60_000;
    const historyStale =
      !cachedHistory?.savedAt || now - cachedHistory.savedAt > 120_000;

    if (latestStale) await refreshLatestFromNetwork();
    if (historyStale) await refreshHistoryFromNetwork();
  }

  async function refreshLatestFromNetwork() {
    if (!room) return;

    const url = `/api/meter?action=latest&room=${encodeURIComponent(room)}`;
    const res = await fetch(url);
    const json = await res.json();

    if (json?.ok && json?.data) {
      setLatest(json.data);
      writeCachedLatest(room, json.data);
    }
  }

  async function refreshHistoryFromNetwork() {
    if (!room) return;

    let url = `/api/meter?action=history&room=${encodeURIComponent(
      room
    )}&limit=24`;
    if (house) url += `&house=${encodeURIComponent(house)}`;

    const res = await fetch(url);
    const json = await res.json();

    if (json?.ok && Array.isArray(json?.data)) {
      const trimmed = filterAndTrim(json.data, 24);
      setHistory(trimmed);
      writeCachedHistory(room, trimmed);
    }
  }

  useEffect(() => {
    if (!router.isReady) return;
    if (!room) return;

    setLoading(true);
    backgroundRefreshIfStale()
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, room]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setShowSheet(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const buttonLabel = latest ? "Edit" : "Add";

  function openSheet() {
    setMsg(null);
    setShowSheet(true);

    if (latest) {
      setDienInput(String(latest.dien ?? ""));
      setNuocInput(String(latest.nuoc ?? ""));
      setNoteInput(String(latest.note ?? ""));
    } else {
      setDienInput("");
      setNuocInput("");
      setNoteInput("");
    }
  }

  async function saveReading() {
    setMsg(null);

    const dienNum = Number(dienInput);
    const nuocNum = Number(nuocInput);

    if (!Number.isFinite(dienNum) || !Number.isFinite(nuocNum)) {
      setMsg("Please enter valid numbers for Điện and Nước.");
      return;
    }

    setSaving(true);
    setShowSheet(false);

    // ✅ optimistic
    const optimistic: Reading = {
      room,
      date: new Date().toISOString(),
      dien: dienNum,
      nuoc: nuocNum,
      id: latest?.id ?? 0,
      note: noteInput.trim(),
    };

    setLatest(optimistic);

    if (house) {
      upsertHouseLatestCache(house, optimistic);

      // ✅ IMPORTANT FIX: monthly upsert (replace same month instead of new row)
      upsertHouseHistoryCache(house, optimistic, 24);
      setHistory((prev) => upsertMonthlyHistory(prev, optimistic, 24));
    }

    setToast("Saved ✅");
    window.setTimeout(() => setToast(null), 1500);

    try {
      const res = await fetch("/api/meter", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-vtpt-pin": getPinForWrite(),
        },
        body: JSON.stringify({
          room,
          dien: dienNum,
          nuoc: nuocNum,
          note: noteInput.trim(),
        }),
      });

      const json = await res.json();
      if (!json.ok) {
        setMsg(json.error || "Save failed.");
        setSaving(false);
        return;
      }

      await refreshLatestFromNetwork();
      setSaving(false);
    } catch (err: any) {
      setMsg(String(err));
      setSaving(false);
    }
  }

  const latestDate = useMemo(() => {
    if (!latest?.date) return null;
    const d = new Date(latest.date);
    return isNaN(d.getTime()) ? null : d;
  }, [latest]);

  const historyRows = useMemo(() => {
    const list = Array.isArray(history) ? history : [];

    return list.map((row, idx) => {
      const currVal = tab === "dien" ? Number(row.dien) : Number(row.nuoc);
      const nextOlder = list[idx + 1];
      const nextVal = nextOlder
        ? tab === "dien"
          ? Number(nextOlder.dien)
          : Number(nextOlder.nuoc)
        : null;

      const diff =
        Number.isFinite(currVal) && Number.isFinite(nextVal as number)
          ? currVal - (nextVal as number)
          : null;

      const d = new Date(row.date);
      const dateLabel = isNaN(d.getTime()) ? row.date : formatDateShort(d);

      return { row, dateLabel, diff };
    });
  }, [history, tab]);

  return (
    <main style={{ padding: 16, maxWidth: 880, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => router.back()} style={{ padding: "8px 12px" }}>
          ← Back
        </button>

        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0 }}>Room: {room}</h1>
          {house ? (
            <div style={{ opacity: 0.7, fontSize: 13 }}>House: {house}</div>
          ) : null}
        </div>

        <button
          onClick={openSheet}
          style={{
            padding: "10px 14px",
            fontWeight: 600,
            borderRadius: 10,
            cursor: "pointer",
          }}
        >
          {buttonLabel}
        </button>
      </div>

      <div style={{ height: 12 }} />

      {toast ? (
        <div
          style={{
            padding: 10,
            borderRadius: 10,
            background: "rgba(0,0,0,0.06)",
            marginBottom: 12,
          }}
        >
          {toast}
        </div>
      ) : null}

      {msg ? (
        <div
          style={{
            padding: 10,
            borderRadius: 10,
            background: "rgba(255,0,0,0.08)",
            marginBottom: 12,
            whiteSpace: "pre-wrap",
          }}
        >
          {msg}
        </div>
      ) : null}

      <div
        style={{
          padding: 14,
          borderRadius: 14,
          border: "1px solid rgba(0,0,0,0.12)",
        }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
          <h2 style={{ margin: 0 }}>Latest</h2>
          {loading ? <span style={{ opacity: 0.7 }}>Loading…</span> : null}
        </div>

        <div style={{ height: 8 }} />

        {latest ? (
          <div style={{ display: "grid", gap: 6 }}>
            <div>
              <b>Date:</b>{" "}
              {latestDate ? formatDateTime(latestDate) : String(latest.date)}
            </div>
            <div>
              <b>Điện:</b> {latest.dien}
            </div>
            <div>
              <b>Nước:</b> {latest.nuoc}
            </div>
            {latest.note ? (
              <div>
                <b>Note:</b> {latest.note}
              </div>
            ) : null}
          </div>
        ) : (
          <div style={{ opacity: 0.7 }}>No readings yet.</div>
        )}
      </div>

      <div style={{ height: 14 }} />

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => setTab("dien")}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid rgba(0,0,0,0.18)",
            background: tab === "dien" ? "rgba(0,0,0,0.08)" : "transparent",
            cursor: "pointer",
          }}
        >
          Điện
        </button>
        <button
          onClick={() => setTab("nuoc")}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid rgba(0,0,0,0.18)",
            background: tab === "nuoc" ? "rgba(0,0,0,0.08)" : "transparent",
            cursor: "pointer",
          }}
        >
          Nước
        </button>
      </div>

      <div style={{ height: 10 }} />

      <div
        style={{
          padding: 14,
          borderRadius: 14,
          border: "1px solid rgba(0,0,0,0.12)",
        }}
      >
        <h2 style={{ marginTop: 0 }}>History (monthly)</h2>

        {historyRows.length ? (
          <div style={{ display: "grid", gap: 10 }}>
            {historyRows.map(({ row, dateLabel, diff }) => (
              <div
                key={row.id ? String(row.id) : `${row.room}-${row.date}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: 10,
                  borderRadius: 12,
                  background: "rgba(0,0,0,0.04)",
                }}
              >
                <div>
                  <div style={{ fontWeight: 700 }}>{dateLabel}</div>
                  {row.note ? (
                    <div style={{ opacity: 0.75, fontSize: 13 }}>
                      {row.note}
                    </div>
                  ) : null}
                </div>

                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 700 }}>
                    {tab === "dien" ? row.dien : row.nuoc}
                  </div>
                  <div style={{ opacity: 0.7, fontSize: 13 }}>
                    Δ {diff === null ? "—" : diff}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ opacity: 0.7 }}>No history yet.</div>
        )}
      </div>

      {showSheet ? (
        <>
          <div
            onClick={() => setShowSheet(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.35)",
            }}
          />
          <div
            style={{
              position: "fixed",
              left: "50%",
              transform: "translateX(-50%)",
              bottom: 12,
              width: "min(560px, calc(100% - 24px))",
              background: "white",
              borderRadius: 16,
              padding: 14,
              boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
            }}
          >
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <b>{latest ? "Edit Reading" : "Add Reading"}</b>
                <button onClick={() => setShowSheet(false)}>✕</button>
              </div>

              <label style={{ display: "grid", gap: 6 }}>
                <span>Điện</span>
                <input
                  value={dienInput}
                  onChange={(e) => setDienInput(e.target.value)}
                  inputMode="numeric"
                  style={{
                    padding: 10,
                    borderRadius: 10,
                    border: "1px solid #ddd",
                  }}
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span>Nước</span>
                <input
                  value={nuocInput}
                  onChange={(e) => setNuocInput(e.target.value)}
                  inputMode="numeric"
                  style={{
                    padding: 10,
                    borderRadius: 10,
                    border: "1px solid #ddd",
                  }}
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span>Note (optional)</span>
                <input
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  style={{
                    padding: 10,
                    borderRadius: 10,
                    border: "1px solid #ddd",
                  }}
                />
              </label>

              <div
                style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}
              >
                <button
                  onClick={() => setShowSheet(false)}
                  style={{ padding: "10px 14px", borderRadius: 10 }}
                >
                  Cancel
                </button>
                <button
                  onClick={saveReading}
                  disabled={saving}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 10,
                    fontWeight: 700,
                    cursor: saving ? "not-allowed" : "pointer",
                  }}
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>

              <div style={{ height: 6 }} />
            </div>
          </div>
        </>
      ) : null}
    </main>
  );
}
