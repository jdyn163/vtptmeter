import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import type React from "react";
import BottomSheet from "../../components/BottomSheet";

type Reading = {
  room: string;
  date: string;
  dien?: number | null;
  nuoc?: number | null;
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

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function isThisMonth(dateStr?: string) {
  if (!dateStr) return false;
  return monthKeyFromDateString(dateStr) === currentMonthKey();
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

function writeHouseHistoryRoomListToCache(
  house: string,
  room: string,
  nextList: Reading[]
) {
  if (!house || !room) return;

  const key = historyKey(house);
  const cached = safeJsonParse<CacheEnvelope<Record<string, Reading[]>>>(
    localStorage.getItem(key)
  );

  const data: Record<string, Reading[]> = cached?.data
    ? { ...cached.data }
    : {};
  data[room] = Array.isArray(nextList) ? nextList.slice() : [];

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

function parseOptionalNumberFromInput(s: string): number | null {
  const raw = String(s ?? "").trim();
  if (!raw.length) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function getReadingValue(row: Reading, tab: "dien" | "nuoc"): number | null {
  const v = tab === "dien" ? row.dien : row.nuoc;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
// ----------------------------------------------------------------

function Field({
  label,
  value,
  onChange,
  onKeyDown,
  onPaste,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onPaste: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  placeholder: string;
}) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ fontWeight: 800, marginLeft: 2 }}>{label}</div>

      <div
        style={{
          background: "#fff",
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: "2px 4px",
        }}
      >
        <input
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          enterKeyHint="done"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={placeholder}
          style={{
            width: "100%",
            padding: 12,
            border: "none",
            outline: "none",
            fontSize: 16,
            background: "transparent",
          }}
        />
      </div>
    </div>
  );
}

export default function RoomPage() {
  const router = useRouter();
  const room = (router.query.room as string) || "";
  const house = (router.query.house as string) || "";

  const [loadingLatest, setLoadingLatest] = useState(true);
  const [latest, setLatest] = useState<Reading | null>(null);

  const [loadingHistory, setLoadingHistory] = useState(true);
  const [history, setHistory] = useState<Reading[]>([]);

  // NEW: third tab in History section
  const [tab, setTab] = useState<"dien" | "nuoc" | "log">("dien");

  const [showSheet, setShowSheet] = useState(false);
  const [showConfirmSheet, setShowConfirmSheet] = useState(false);

  const [dienInput, setDienInput] = useState("");
  const [nuocInput, setNuocInput] = useState("");
  const [noteInput, setNoteInput] = useState("");

  const [editing, setEditing] = useState<Reading | null>(null);
  const isEditing = !!editing;

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // NEW: log state
  const [loadingLog, setLoadingLog] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logErr, setLogErr] = useState<string | null>(null);

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
      // ignore
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

  async function refreshLogFromNetwork() {
    if (!room) return;
    setLoadingLog(true);
    setLogErr(null);
    try {
      const r = await fetch(
        `/api/meter?action=log&room=${encodeURIComponent(room)}&limit=200`
      );
      const j = await r.json();
      if (!j?.ok) {
        setLogErr(j?.error || "Failed to load log.");
        setLogLines([]);
      } else {
        setLogLines(Array.isArray(j.data) ? j.data : []);
      }
    } catch (e: any) {
      setLogErr(String(e?.message || e));
      setLogLines([]);
    } finally {
      setLoadingLog(false);
    }
  }

  function closeEditSheet() {
    if (saving) return;
    setShowSheet(false);
    setEditing(null);
    setMsg(null);
  }

  function sortNewestFirst(list: Reading[]) {
    const next = Array.isArray(list) ? list.slice() : [];
    next.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    return next;
  }

  function recomputeLatestFromHistory(nextHistory: Reading[]) {
    const nextSorted = sortNewestFirst(nextHistory);
    const top = nextSorted.length > 0 ? nextSorted[0] : null;
    setLatest(top);

    if (house && top) {
      upsertHouseLatestCache(house, top);
    }
  }

  useEffect(() => {
    if (!room) return;

    setShowSheet(false);
    setShowConfirmSheet(false);
    setEditing(null);
    setDienInput("");
    setNuocInput("");
    setNoteInput("");
    setMsg(null);
    setToast(null);
    setTab("dien");
    setLogLines([]);
    setLogErr(null);

    loadFromCaches();
    backgroundRefreshIfStale();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, house]);

  // When switching to Log tab, fetch it
  useEffect(() => {
    if (tab === "log") refreshLogFromNetwork();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, room]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) {
        if (showConfirmSheet) {
          setShowConfirmSheet(false);
          setShowSheet(true);
          setMsg(null);
        } else {
          closeEditSheet();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saving, showConfirmSheet]);

  const hasThisMonth = !!(latest && isThisMonth(latest.date));
  const buttonLabel = hasThisMonth ? "Edit" : "Add";

  function openSheet() {
    setMsg(null);
    setEditing(null);
    setShowConfirmSheet(false);
    setShowSheet(true);

    // ✅ IMPORTANT: New month should be EMPTY (do NOT carry last month's numbers)
    if (latest && isThisMonth(latest.date)) {
      setDienInput(
        typeof latest.dien === "number" && Number.isFinite(latest.dien)
          ? String(latest.dien)
          : ""
      );
      setNuocInput(
        typeof latest.nuoc === "number" && Number.isFinite(latest.nuoc)
          ? String(latest.nuoc)
          : ""
      );
      setNoteInput(String(latest.note ?? ""));
    } else {
      setDienInput("");
      setNuocInput("");
      setNoteInput("");
    }
  }

  function openEditRow(r: Reading) {
    if (saving) return;
    setMsg(null);
    setEditing(r);
    setShowConfirmSheet(false);
    setShowSheet(true);

    setDienInput(
      typeof r.dien === "number" && Number.isFinite(r.dien)
        ? String(r.dien)
        : ""
    );
    setNuocInput(
      typeof r.nuoc === "number" && Number.isFinite(r.nuoc)
        ? String(r.nuoc)
        : ""
    );
    setNoteInput(String(r.note ?? ""));
  }

  const canTapCard = !saving && !loadingLatest && !!room && !!house;

  function onMeterCardKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!canTapCard) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openSheet();
    }
  }

  function requestConfirmSave() {
    setMsg(null);

    const dienNum = parseOptionalNumberFromInput(dienInput);
    const nuocNum = parseOptionalNumberFromInput(nuocInput);

    if (dienNum === null && nuocNum === null) {
      setMsg("Enter at least one meter value (Điện or Nước).");
      return;
    }

    setShowSheet(false);
    setShowConfirmSheet(true);
  }

  async function commitSaveReading() {
    setMsg(null);

    const dienNum = parseOptionalNumberFromInput(dienInput);
    const nuocNum = parseOptionalNumberFromInput(nuocInput);

    if (dienNum === null && nuocNum === null) {
      setMsg("Enter at least one meter value (Điện or Nước).");
      return;
    }

    setSaving(true);
    setShowConfirmSheet(false);

    const optimistic: Reading = {
      room,
      date: editing?.date ?? new Date().toISOString(),
      id: editing?.id ?? latest?.id ?? 0,
      dien: dienNum,
      nuoc: nuocNum,
      note: noteInput.trim(),
    };

    if (house) {
      if (isEditing && editing) {
        setHistory((prev) => {
          const replaced = prev.map((x) =>
            x.id === editing.id && x.date === editing.date ? optimistic : x
          );
          const next = sortNewestFirst(replaced).slice(0, 24);
          writeHouseHistoryRoomListToCache(house, room, next);
          recomputeLatestFromHistory(next);
          return next;
        });
      } else {
        upsertHouseLatestCache(house, optimistic);
        upsertHouseHistoryCache(house, optimistic, 24);
        setHistory((prev) => {
          const next = upsertMonthlyHistory(prev, optimistic, 24);
          recomputeLatestFromHistory(next);
          return next;
        });
        setLatest(optimistic);
      }
    } else {
      setLatest(optimistic);
    }

    setEditing(null);

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
          action: isEditing ? "update" : "save",
          room,
          dien: dienNum,
          nuoc: nuocNum,
          note: noteInput.trim(),
          target:
            isEditing && editing
              ? { id: editing.id, date: editing.date }
              : undefined,
        }),
      });

      const json = await res.json();
      if (!json.ok) {
        setMsg(json.error || "Save failed.");
        setSaving(false);
        await refreshLatestFromNetwork();
        return;
      }

      await refreshLatestFromNetwork();
      // If user is on Log tab, refresh it too
      if (tab === "log") await refreshLogFromNetwork();

      setSaving(false);
    } catch (err: any) {
      setMsg(String(err));
      setSaving(false);
    }
  }

  async function deleteEditingRow() {
    if (!editing || saving) return;

    const ok = window.confirm("Delete this reading? This can't be undone.");
    if (!ok) return;

    setSaving(true);
    closeEditSheet();

    setHistory((prev) => {
      const next = prev.filter(
        (x) => !(x.id === editing.id && x.date === editing.date)
      );
      const sorted = sortNewestFirst(next).slice(0, 24);

      if (house) writeHouseHistoryRoomListToCache(house, room, sorted);
      recomputeLatestFromHistory(sorted);

      return sorted;
    });

    setToast("Deleted ✅");
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
          action: "delete",
          room,
          target: { id: editing.id, date: editing.date },
        }),
      });

      const json = await res.json();
      if (!json.ok) {
        setMsg(json.error || "Delete failed.");
        setSaving(false);
        await refreshLatestFromNetwork();
        return;
      }

      await refreshLatestFromNetwork();
      if (tab === "log") await refreshLogFromNetwork();

      setSaving(false);
    } catch (err: any) {
      setMsg(String(err));
      setSaving(false);
    } finally {
      setEditing(null);
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
      const currVal = getReadingValue(row, tab === "log" ? "dien" : tab);
      const nextOlder = list[idx + 1];
      const prevVal =
        nextOlder && tab !== "log" ? getReadingValue(nextOlder, tab) : null;

      const diff =
        tab === "log" || currVal === null || prevVal === null
          ? null
          : currVal - prevVal;

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
        valueText: currVal === null ? "--" : String(currVal),
        diff,
        diffColor,
        row,
      };
    });
  }, [history, tab]);

  // ✅ show "This month reading" as empty unless latest is in THIS month
  const showThisMonthNumbers = hasThisMonth;

  const latestDien =
    showThisMonthNumbers &&
    latest &&
    typeof latest.dien === "number" &&
    Number.isFinite(latest.dien)
      ? latest.dien
      : null;

  const latestNuoc =
    showThisMonthNumbers &&
    latest &&
    typeof latest.nuoc === "number" &&
    Number.isFinite(latest.nuoc)
      ? latest.nuoc
      : null;

  const confirmDien = parseOptionalNumberFromInput(dienInput);
  const confirmNuoc = parseOptionalNumberFromInput(nuocInput);

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
            <div style={{ marginTop: 10, fontSize: 34, fontWeight: 900 }}>
              {loadingLatest ? "…" : latestDien === null ? "— — —" : latestDien}
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
            <div style={{ marginTop: 10, fontSize: 34, fontWeight: 900 }}>
              {loadingLatest ? "…" : latestNuoc === null ? "— — —" : latestNuoc}
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
          <button
            onClick={() => setTab("log")}
            style={{
              flex: 1,
              padding: 10,
              borderRadius: 999,
              border: "1px solid #ddd",
              background: tab === "log" ? "#111" : "#fff",
              color: tab === "log" ? "#fff" : "#111",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            Log
          </button>
        </div>

        {tab === "log" ? (
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
                padding: 12,
                fontWeight: 900,
                opacity: 0.7,
                borderBottom: "1px solid #eee",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <div>Room Log</div>
              <button
                onClick={refreshLogFromNetwork}
                disabled={loadingLog}
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  background: "#fff",
                  cursor: loadingLog ? "not-allowed" : "pointer",
                  fontWeight: 900,
                }}
              >
                {loadingLog ? "Loading…" : "Refresh"}
              </button>
            </div>

            {logErr && (
              <div style={{ padding: 12, color: "#b00020", fontWeight: 800 }}>
                {logErr}
              </div>
            )}

            {!logErr && loadingLog && (
              <div style={{ padding: 12, opacity: 0.7 }}>Loading…</div>
            )}

            {!logErr && !loadingLog && logLines.length === 0 && (
              <div style={{ padding: 12, opacity: 0.7 }}>No log yet.</div>
            )}

            {!logErr &&
              !loadingLog &&
              logLines.map((line, idx) => (
                <div
                  key={`${idx}-${line}`}
                  style={{
                    padding: 12,
                    borderBottom: "1px solid #f2f2f2",
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                    fontSize: 12,
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.35,
                  }}
                >
                  {line}
                </div>
              ))}
          </div>
        ) : (
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
                  onClick={() => openEditRow(r.row)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openEditRow(r.row);
                    }
                  }}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.2fr 1fr 1fr",
                    padding: 12,
                    borderBottom: "1px solid #f2f2f2",
                    alignItems: "center",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 800 }}>{r.dateText}</div>
                  <div style={{ fontWeight: 900 }}>{r.valueText}</div>
                  <div style={{ fontWeight: 900, color: r.diffColor }}>
                    {diffText(r.diff)}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Edit Sheet (Step 1) */}
      <BottomSheet
        open={showSheet}
        title={isEditing ? "Edit history" : `${buttonLabel} reading`}
        onClose={closeEditSheet}
        disabled={saving}
      >
        <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
          <Field
            label="Điện"
            value={dienInput}
            onChange={(raw) => setNumberOnly(raw, setDienInput)}
            onKeyDown={blockNonNumericKeys}
            onPaste={(e) => {
              e.preventDefault();
              setDienInput(digitsOnly(e.clipboardData.getData("text")));
            }}
            placeholder="Enter điện"
          />

          <Field
            label="Nước"
            value={nuocInput}
            onChange={(raw) => setNumberOnly(raw, setNuocInput)}
            onKeyDown={blockNonNumericKeys}
            onPaste={(e) => {
              e.preventDefault();
              setNuocInput(digitsOnly(e.clipboardData.getData("text")));
            }}
            placeholder="Enter nước"
          />

          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 800, marginLeft: 2 }}>
              Note (optional)
            </div>
            <div
              style={{
                background: "#fff",
                border: "1px solid #ddd",
                borderRadius: 12,
                padding: "2px 4px",
              }}
            >
              <input
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                placeholder="ie. thay đồng hồ điện"
                style={{
                  width: "100%",
                  padding: 12,
                  border: "none",
                  outline: "none",
                  fontSize: 16,
                  background: "transparent",
                }}
              />
            </div>
          </div>

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
            {isEditing ? (
              <button
                onClick={deleteEditingRow}
                disabled={saving}
                style={{
                  padding: 12,
                  borderRadius: 12,
                  border: "1px solid #ddd",
                  background: "#fff",
                  fontWeight: 900,
                  cursor: saving ? "not-allowed" : "pointer",
                  color: "#dc2626",
                }}
              >
                Delete
              </button>
            ) : (
              <button
                onClick={() => !saving && closeEditSheet()}
                disabled={saving}
                style={{
                  padding: 12,
                  borderRadius: 12,
                  border: "1px solid #ddd",
                  background: "#fff",
                  fontWeight: 900,
                  cursor: saving ? "not-allowed" : "pointer",
                }}
              >
                Cancel
              </button>
            )}

            <button
              onClick={requestConfirmSave}
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
              Save
            </button>
          </div>

          <div style={{ height: 6 }} />
        </div>
      </BottomSheet>

      {/* Confirm Sheet (Step 2) - numbers only */}
      <BottomSheet
        open={showConfirmSheet}
        title="Confirm"
        onClose={() => {
          if (saving) return;
          setShowConfirmSheet(false);
          setShowSheet(true);
          setMsg(null);
        }}
        disabled={saving}
      >
        <div style={{ marginTop: 12, display: "grid", gap: 14 }}>
          <div
            style={{
              background: "#fff",
              border: "1px solid #e5e5e5",
              borderRadius: 14,
              padding: 14,
            }}
          >
            <div style={{ fontWeight: 900, opacity: 0.7 }}>Electric Meter</div>
            <div
              style={{
                marginTop: 8,
                display: "flex",
                alignItems: "baseline",
                gap: 10,
              }}
            >
              <div style={{ fontSize: 44, fontWeight: 950 }}>
                {confirmDien === null ? "— — —" : confirmDien}
              </div>
              <div style={{ fontWeight: 800, opacity: 0.45 }}>kWh</div>
            </div>
          </div>

          <div
            style={{
              background: "#fff",
              border: "1px solid #e5e5e5",
              borderRadius: 14,
              padding: 14,
            }}
          >
            <div style={{ fontWeight: 900, opacity: 0.7 }}>Water Meter</div>
            <div
              style={{
                marginTop: 8,
                display: "flex",
                alignItems: "baseline",
                gap: 10,
              }}
            >
              <div style={{ fontSize: 44, fontWeight: 950 }}>
                {confirmNuoc === null ? "— — —" : confirmNuoc}
              </div>
              <div style={{ fontWeight: 800, opacity: 0.45 }}>m³</div>
            </div>
          </div>

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
              onClick={() => {
                if (saving) return;
                setShowConfirmSheet(false);
                setShowSheet(true);
                setMsg(null);
              }}
              disabled={saving}
              style={{
                padding: 12,
                borderRadius: 12,
                border: "1px solid #ddd",
                background: "#fff",
                fontWeight: 900,
                cursor: saving ? "not-allowed" : "pointer",
              }}
            >
              Back
            </button>

            <button
              onClick={commitSaveReading}
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
              {saving ? "Saving..." : "Confirm & Save"}
            </button>
          </div>

          <div style={{ height: 6 }} />
        </div>
      </BottomSheet>
    </main>
  );
}
