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

function formatDateShort(d: Date) {
  return d.toLocaleDateString();
}

function formatDateTime(d: Date) {
  return d.toLocaleString();
}

function diffText(diff: number | null) {
  if (diff === null) return "--";
  if (diff > 0) return `+${diff}`;
  return String(diff);
}

function latestKey(house: string) {
  return `vtpt_houseLatest_${house}`;
}
function historyKey(house: string) {
  return `vtpt_houseHistory_${house}`;
}

function safeJsonParse<T>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function monthKeyFromDateString(dateStr: string) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "unknown";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function upsertMonthlyHistory(list: Reading[], incoming: Reading, max = 24) {
  const mk = monthKeyFromDateString(incoming.date);

  const next = Array.isArray(list) ? list.slice() : [];
  const filtered = next.filter((r) => monthKeyFromDateString(r.date) !== mk);

  filtered.unshift(incoming);

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

function upsertHouseLatestCache(house: string, updated: Reading) {
  if (!house) return;

  const key = latestKey(house);
  const cached = safeJsonParse<CacheEnvelope<Reading[]>>(
    localStorage.getItem(key)
  );

  const data = Array.isArray(cached?.data) ? cached!.data.slice() : [];
  const idx = data.findIndex((x) => x.room === updated.room);

  if (idx >= 0) data[idx] = updated;
  else data.push(updated);

  localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
}

function upsertHouseHistoryCache(
  house: string,
  reading: Reading,
  maxPerRoom = 24
) {
  if (!house) return;

  const key = historyKey(house);
  const cached = safeJsonParse<CacheEnvelope<Record<string, Reading[]>>>(
    localStorage.getItem(key)
  );

  const data: Record<string, Reading[]> = cached?.data
    ? { ...cached.data }
    : {};
  const list = Array.isArray(data[reading.room]) ? data[reading.room] : [];

  data[reading.room] = upsertMonthlyHistory(list, reading, maxPerRoom);

  localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
}

// -------------------- Numeric-only helpers --------------------
function digitsOnly(s: string) {
  return String(s ?? "").replace(/[^\d]/g, "");
}

function setNumberOnly(raw: string, setter: (v: string) => void) {
  setter(digitsOnly(raw));
}

function blockNonNumericKeys(e: React.KeyboardEvent<HTMLInputElement>) {
  const allowed = [
    "Backspace",
    "Delete",
    "Tab",
    "Enter",
    "Escape",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Home",
    "End",
  ];
  if (allowed.includes(e.key)) return;
  if (e.ctrlKey || e.metaKey) return;
  if (/^\d$/.test(e.key)) return;
  e.preventDefault();
}
// ----------------------------------------------------------------

export default function RoomPage() {
  const router = useRouter();
  const room = (router.query.room as string) || "";
  const house = (router.query.house as string) || "";

  const [loadingLatest, setLoadingLatest] = useState(true);
  const [latest, setLatest] = useState<Reading | null>(null);

  const [loadingHistory, setLoadingHistory] = useState(true);
  const [history, setHistory] = useState<Reading[]>([]);

  const [tab, setTab] = useState<"dien" | "nuoc">("dien");

  const [showSheet, setShowSheet] = useState(false);
  const [dienInput, setDienInput] = useState("");
  const [nuocInput, setNuocInput] = useState("");
  const [noteInput, setNoteInput] = useState("");

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const TTL_MS = 2 * 60 * 1000;

  function loadFromCaches() {
    if (!room || !house) return;

    setLoadingLatest(true);
    const cachedLatest = safeJsonParse<CacheEnvelope<Reading[]>>(
      localStorage.getItem(latestKey(house))
    );
    const foundLatest =
      cachedLatest?.data?.find((x) => x.room === room) || null;
    setLatest(foundLatest);
    setLoadingLatest(false);

    setLoadingHistory(true);
    const cachedHist = safeJsonParse<CacheEnvelope<Record<string, Reading[]>>>(
      localStorage.getItem(historyKey(house))
    );
    const list = cachedHist?.data?.[room];
    setHistory(Array.isArray(list) ? list : []);
    setLoadingHistory(false);
  }

  async function backgroundRefreshIfStale() {
    if (!house) return;

    const latestCache = safeJsonParse<CacheEnvelope<Reading[]>>(
      localStorage.getItem(latestKey(house))
    );
    const histCache = safeJsonParse<CacheEnvelope<Record<string, Reading[]>>>(
      localStorage.getItem(historyKey(house))
    );

    const latestFresh =
      latestCache?.savedAt && Date.now() - latestCache.savedAt < TTL_MS;
    const histFresh =
      histCache?.savedAt && Date.now() - histCache.savedAt < TTL_MS;

    if (latestFresh && histFresh) return;

    try {
      if (!latestFresh) {
        const r1 = await fetch(
          `/api/meter?action=houseLatest&house=${encodeURIComponent(house)}`
        );
        const j1 = await r1.json();
        const arr: Reading[] = Array.isArray(j1?.data) ? j1.data : [];
        localStorage.setItem(
          latestKey(house),
          JSON.stringify({ savedAt: Date.now(), data: arr })
        );
      }

      if (!histFresh) {
        const r2 = await fetch(
          `/api/meter?action=houseHistory&house=${encodeURIComponent(
            house
          )}&limitPerRoom=24`
        );
        const j2 = await r2.json();
        const data: Record<string, Reading[]> =
          j2 && j2.ok && j2.data ? j2.data : {};
        localStorage.setItem(
          historyKey(house),
          JSON.stringify({ savedAt: Date.now(), data })
        );
      }

      loadFromCaches();
    } catch {
      // ignore; cache UI still works
    }
  }

  async function refreshLatestFromNetwork() {
    if (!room) return;
    try {
      const latestRes = await fetch(
        `/api/meter?room=${encodeURIComponent(room)}&action=latest`
      );
      const latestJson = await latestRes.json();
      const latestData: Reading | null = latestJson?.data || null;

      setLatest(latestData);
      if (latestData && house) upsertHouseLatestCache(house, latestData);

      if (latestData && house) {
        upsertHouseHistoryCache(house, latestData, 24);
        setHistory((prev) => upsertMonthlyHistory(prev, latestData, 24));
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (!room) return;

    setShowSheet(false);
    setDienInput("");
    setNuocInput("");
    setNoteInput("");
    setMsg(null);
    setToast(null);
    setTab("dien");

    loadFromCaches();
    backgroundRefreshIfStale();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, house]);

  useEffect(() => {
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

  // ✅ NEW: both meter cards are tappable (and keyboard-friendly)
  const canTapCard = !saving && !loadingLatest && !!room && !!house;

  function onMeterCardKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!canTapCard) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openSheet();
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
      upsertHouseHistoryCache(house, optimistic, 24);
      setHistory((prev) => upsertMonthlyHistory(prev, optimistic, 24));
    }

    setToast("Saved ✅");
    window.setTimeout(() => setToast(null), 1500);

    try {
      const pin = (sessionStorage.getItem("vtpt_pin") || "").trim();
      if (!pin) {
        setMsg("Missing PIN. Please go back and unlock again.");
        setSaving(false);
        return;
      }

      const res = await fetch("/api/meter", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-vtpt-pin": pin,
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
      const prevVal = nextOlder
        ? tab === "dien"
          ? Number(nextOlder.dien)
          : Number(nextOlder.nuoc)
        : null;

      const diff = prevVal === null ? null : currVal - prevVal;

      // ✅ NEW: color for diff
      const diffColor =
        diff === null
          ? undefined
          : diff > 0
          ? "#16a34a"
          : diff < 0
          ? "#dc2626"
          : undefined;

      const d = new Date(row.date);
      const safeDate = isNaN(d.getTime()) ? null : d;

      return {
        key: `${row.room}-${row.id}-${row.date}-${tab}`,
        dateText: safeDate ? formatDateShort(safeDate) : String(row.date),
        value: currVal,
        diff,
        diffColor,
      };
    });
  }, [history, tab]);

  return (
    <main
      style={{
        padding: 16,
        maxWidth: 520,
        margin: "0 auto",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button
          onClick={() => router.push(`/house/${encodeURIComponent(house)}`)}
          style={{
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: "#fff",
            cursor: "pointer",
          }}
        >
          ←
        </button>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{room}</div>
          <div style={{ fontSize: 12, opacity: 0.6 }}>
            {latestDate
              ? `Last recorded: ${formatDateTime(latestDate)}`
              : "No record yet"}
          </div>
        </div>

        {toast && (
          <div
            style={{
              padding: "6px 10px",
              borderRadius: 999,
              border: "1px solid #ddd",
              background: "#fff",
              fontWeight: 800,
              fontSize: 12,
            }}
          >
            {toast}
          </div>
        )}
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={{ fontSize: 16, fontWeight: 800, opacity: 0.75 }}>
          This month reading
        </div>

        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
          {/* ✅ Electric Meter box is tappable */}
          <div
            onClick={() => canTapCard && openSheet()}
            onKeyDown={onMeterCardKeyDown}
            role="button"
            tabIndex={canTapCard ? 0 : -1}
            aria-disabled={!canTapCard}
            style={{
              background: "#fff",
              border: "1px solid #e5e5e5",
              borderRadius: 14,
              padding: 16,
              cursor: canTapCard ? "pointer" : "not-allowed",
            }}
          >
            <div style={{ fontWeight: 800, opacity: 0.8 }}>Electric Meter</div>
            <div
              style={{
                marginTop: 10,
                fontSize: 34,
                fontWeight: 900,
                letterSpacing: -1,
              }}
            >
              {loadingLatest ? "…" : latest ? latest.dien : "— — —"}
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  opacity: 0.4,
                  marginLeft: 8,
                }}
              >
                kWh
              </span>
            </div>
          </div>

          {/* ✅ Water Meter box is tappable */}
          <div
            onClick={() => canTapCard && openSheet()}
            onKeyDown={onMeterCardKeyDown}
            role="button"
            tabIndex={canTapCard ? 0 : -1}
            aria-disabled={!canTapCard}
            style={{
              background: "#fff",
              border: "1px solid #e5e5e5",
              borderRadius: 14,
              padding: 16,
              cursor: canTapCard ? "pointer" : "not-allowed",
            }}
          >
            <div style={{ fontWeight: 800, opacity: 0.8 }}>Water Meter</div>
            <div
              style={{
                marginTop: 10,
                fontSize: 34,
                fontWeight: 900,
                letterSpacing: -1,
              }}
            >
              {loadingLatest ? "…" : latest ? latest.nuoc : "— — —"}
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  opacity: 0.4,
                  marginLeft: 8,
                }}
              >
                m³
              </span>
            </div>
          </div>

          {/* ✅ Removed Edit/Add button */}
        </div>
      </div>

      <div style={{ marginTop: 22 }}>
        <div style={{ fontSize: 16, fontWeight: 900, opacity: 0.75 }}>
          History
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <button
            onClick={() => setTab("dien")}
            style={{
              flex: 1,
              padding: 10,
              borderRadius: 999,
              border: "1px solid #ddd",
              background: tab === "dien" ? "#111" : "#fff",
              color: tab === "dien" ? "#fff" : "#111",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            Electric
          </button>
          <button
            onClick={() => setTab("nuoc")}
            style={{
              flex: 1,
              padding: 10,
              borderRadius: 999,
              border: "1px solid #ddd",
              background: tab === "nuoc" ? "#111" : "#fff",
              color: tab === "nuoc" ? "#fff" : "#111",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            Water
          </button>
        </div>

        <div
          style={{
            marginTop: 12,
            background: "#fff",
            border: "1px solid #e5e5e5",
            borderRadius: 14,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.2fr 1fr 1fr",
              padding: 12,
              fontWeight: 900,
              opacity: 0.7,
              borderBottom: "1px solid #eee",
            }}
          >
            <div>Date</div>
            <div>Value</div>
            <div>Difference</div>
          </div>

          {loadingHistory && (
            <div style={{ padding: 12, opacity: 0.7 }}>Loading…</div>
          )}

          {!loadingHistory && historyRows.length === 0 && (
            <div style={{ padding: 12, opacity: 0.7 }}>No history yet.</div>
          )}

          {!loadingHistory &&
            historyRows.map((r) => (
              <div
                key={r.key}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.2fr 1fr 1fr",
                  padding: 12,
                  borderBottom: "1px solid #f2f2f2",
                  alignItems: "center",
                }}
              >
                <div style={{ fontWeight: 800 }}>{r.dateText}</div>
                <div style={{ fontWeight: 900 }}>{r.value}</div>

                {/* ✅ NEW: colorize diff */}
                <div
                  style={{
                    fontWeight: 900,
                    opacity: 0.95,
                    color: r.diffColor,
                  }}
                >
                  {diffText(r.diff)}
                </div>
              </div>
            ))}
        </div>
      </div>

      {showSheet && (
        <>
          <div
            onClick={() => !saving && setShowSheet(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.35)",
              zIndex: 50,
            }}
          />

          <div
            style={{
              position: "fixed",
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 60,
              background: "#fff",
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              borderTop: "1px solid #eee",
              padding: 16,
              boxShadow: "0 -10px 30px rgba(0,0,0,0.12)",
              transform: "translateY(0)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontWeight: 900, fontSize: 16, flex: 1 }}>
                {buttonLabel} reading
              </div>
              <button
                onClick={() => !saving && setShowSheet(false)}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 999,
                  border: "1px solid #ddd",
                  background: "#fff",
                  cursor: "pointer",
                  fontWeight: 900,
                }}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
              <label>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>Điện</div>
                <input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  enterKeyHint="done"
                  value={dienInput}
                  onChange={(e) => setNumberOnly(e.target.value, setDienInput)}
                  onKeyDown={blockNonNumericKeys}
                  onPaste={(e) => {
                    e.preventDefault();
                    const text = e.clipboardData.getData("text");
                    setDienInput(digitsOnly(text));
                  }}
                  placeholder="Enter điện"
                  style={{
                    width: "100%",
                    padding: 12,
                    borderRadius: 10,
                    border: "1px solid #ddd",
                    fontSize: 16,
                  }}
                />
              </label>

              <label>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>Nước</div>
                <input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  enterKeyHint="done"
                  value={nuocInput}
                  onChange={(e) => setNumberOnly(e.target.value, setNuocInput)}
                  onKeyDown={blockNonNumericKeys}
                  onPaste={(e) => {
                    e.preventDefault();
                    const text = e.clipboardData.getData("text");
                    setNuocInput(digitsOnly(text));
                  }}
                  placeholder="Enter nước"
                  style={{
                    width: "100%",
                    padding: 12,
                    borderRadius: 10,
                    border: "1px solid #ddd",
                    fontSize: 16,
                  }}
                />
              </label>

              <label>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>
                  Note (optional)
                </div>
                <input
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  placeholder="Optional note"
                  style={{
                    width: "100%",
                    padding: 12,
                    borderRadius: 10,
                    border: "1px solid #ddd",
                    fontSize: 16,
                  }}
                />
              </label>

              {msg && (
                <div style={{ color: "#b00020", fontWeight: 800 }}>{msg}</div>
              )}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                }}
              >
                <button
                  onClick={() => !saving && setShowSheet(false)}
                  disabled={saving}
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    border: "1px solid #ddd",
                    background: "#fff",
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>

                <button
                  onClick={saveReading}
                  disabled={saving}
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    border: "1px solid #111",
                    background: saving ? "#ddd" : "#111",
                    color: saving ? "#333" : "#fff",
                    fontWeight: 900,
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
      )}
    </main>
  );
}
