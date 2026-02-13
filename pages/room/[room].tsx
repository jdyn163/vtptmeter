// pages/room/[room].tsx
import { useRouter } from "next/router";
import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import BottomSheet from "../../components/BottomSheet";

type Reading = {
  room: string;
  date: string;
  dien?: number | null;
  nuoc?: number | null;
  id: number;
  note?: string;

  // from sheet: explicit cycle key like "2026-03"
  cycle?: string;
};

type CacheEnvelope<T> = { savedAt: number; data: T };

const VN_TZ = "Asia/Ho_Chi_Minh";

function formatDateShort(d: Date) {
  return d.toLocaleDateString("en-GB", {
    timeZone: VN_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatDateTime(d: Date) {
  return d.toLocaleString("en-GB", { timeZone: VN_TZ });
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
function cycleKey() {
  return `vtpt_cycle_month`;
}
function deleteOutboxKey() {
  return `vtpt_delete_outbox_v1`;
}
function writeOutboxKey() {
  return `vtpt_write_outbox_v1`;
}

function safeJsonParse<T>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

/** Fallback only for OLD rows that don't have cycle stamped */
function monthKeyFromDateString(dateStr: string) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "unknown";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * ✅ New truth:
 * - If row has cycle => compare directly
 * - If row missing cycle (old data) => fallback to date-month
 */
function isRowInCycle(row: Reading | null, cycleMonth: string | null) {
  if (!row || !cycleMonth) return false;
  const c = String(row.cycle || "").trim();
  if (c) return c === cycleMonth;
  return monthKeyFromDateString(row.date) === cycleMonth;
}

function upsertMonthlyHistory(list: Reading[], incoming: Reading, max = 24) {
  const mk =
    String(incoming.cycle || "").trim() ||
    monthKeyFromDateString(incoming.date);

  const next = Array.isArray(list) ? list.slice() : [];
  const filtered = next.filter((r) => {
    const rk = String(r.cycle || "").trim() || monthKeyFromDateString(r.date);
    return rk !== mk;
  });

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
    localStorage.getItem(key),
  );

  const data = Array.isArray(cached?.data) ? cached!.data.slice() : [];
  const idx = data.findIndex((x) => x.room === updated.room);

  if (idx >= 0) data[idx] = updated;
  else data.push(updated);

  localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
}

function removeHouseLatestIfMatch(
  house: string,
  room: string,
  target: { id: number; date: string },
) {
  if (!house || !room) return;

  const key = latestKey(house);
  const cached = safeJsonParse<CacheEnvelope<Reading[]>>(
    localStorage.getItem(key),
  );
  const data = Array.isArray(cached?.data) ? cached!.data.slice() : [];
  const idx = data.findIndex((x) => x.room === room);

  if (idx < 0) return;

  const cur = data[idx];
  if (cur && cur.id === target.id && cur.date === target.date) {
    data.splice(idx, 1);
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
  }
}

function writeHouseHistoryRoomListToCache(
  house: string,
  room: string,
  nextList: Reading[],
) {
  if (!house || !room) return;

  const key = historyKey(house);
  const cached = safeJsonParse<CacheEnvelope<Record<string, Reading[]>>>(
    localStorage.getItem(key),
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
  maxPerRoom = 24,
) {
  if (!house) return;

  const key = historyKey(house);
  const cached = safeJsonParse<CacheEnvelope<Record<string, Reading[]>>>(
    localStorage.getItem(key),
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

// ✅ VN-day compare (for "same day => update instead of add row")
function vnDayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "invalid";
  return d.toLocaleDateString("en-CA", { timeZone: VN_TZ }); // YYYY-MM-DD
}
function isSameVNDay(aIso: string, bIso: string) {
  return vnDayKey(aIso) === vnDayKey(bIso);
}

function makeId(): string {
  try {
    // @ts-ignore
    return typeof crypto !== "undefined" && crypto.randomUUID
      ? // @ts-ignore
        crypto.randomUUID()
      : `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  } catch {
    return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

/* ===================== Delete Outbox ===================== */
type DeleteOutboxItem = {
  kind: "delete";
  room: string;
  target: { id: number; date: string };
  createdAt: number;
  tries: number;
};

function readDeleteOutbox(): DeleteOutboxItem[] {
  const raw = safeJsonParse<CacheEnvelope<DeleteOutboxItem[]>>(
    localStorage.getItem(deleteOutboxKey()),
  );
  const list = Array.isArray(raw?.data) ? raw!.data : [];
  return list.filter(
    (x) =>
      x &&
      x.kind === "delete" &&
      typeof x.room === "string" &&
      x.target &&
      typeof x.target.id === "number" &&
      typeof x.target.date === "string",
  );
}

function writeDeleteOutbox(list: DeleteOutboxItem[]) {
  localStorage.setItem(
    deleteOutboxKey(),
    JSON.stringify({ savedAt: Date.now(), data: list }),
  );
}

function enqueueDelete(room: string, target: { id: number; date: string }) {
  if (!room) return;
  const list = readDeleteOutbox();

  // de-dupe (same room + same target)
  const exists = list.some(
    (x) =>
      x.kind === "delete" &&
      x.room === room &&
      x.target.id === target.id &&
      x.target.date === target.date,
  );
  if (exists) return;

  list.unshift({
    kind: "delete",
    room,
    target,
    createdAt: Date.now(),
    tries: 0,
  });

  // small cap
  writeDeleteOutbox(list.slice(0, 80));
}
/* ========================================================= */

/* ===================== Write Outbox ===================== */
type WriteAction = "save" | "update";

type WriteOutboxItem = {
  kind: "write";
  id: string;
  createdAt: number;
  tries: number;
  payload: {
    action: WriteAction;
    room: string;
    dien: number | null;
    nuoc: number | null;
    note: string;
    target?: { id: number; date: string };
  };
};

function readWriteOutbox(): WriteOutboxItem[] {
  const raw = safeJsonParse<CacheEnvelope<WriteOutboxItem[]>>(
    localStorage.getItem(writeOutboxKey()),
  );
  const list = Array.isArray(raw?.data) ? raw!.data : [];
  return list.filter(
    (x) =>
      x &&
      x.kind === "write" &&
      typeof x.id === "string" &&
      x.payload &&
      typeof x.payload.room === "string" &&
      (x.payload.action === "save" || x.payload.action === "update"),
  );
}

function writeWriteOutbox(list: WriteOutboxItem[]) {
  localStorage.setItem(
    writeOutboxKey(),
    JSON.stringify({ savedAt: Date.now(), data: list }),
  );
}

function enqueueWrite(item: WriteOutboxItem["payload"]) {
  if (!item?.room) return;
  const list = readWriteOutbox();

  list.unshift({
    kind: "write",
    id: makeId(),
    createdAt: Date.now(),
    tries: 0,
    payload: item,
  });

  // cap (writes can pile up)
  writeWriteOutbox(list.slice(0, 120));
}
/* ========================================================= */

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

  const [latestOverall, setLatestOverall] = useState<Reading | null>(null);

  const [loadingHistory, setLoadingHistory] = useState(true);
  const [history, setHistory] = useState<Reading[]>([]);

  const [cycleMonth, setCycleMonth] = useState<string | null>(null);
  const [loadingCycle, setLoadingCycle] = useState(true);

  const [tab, setTab] = useState<"dien" | "nuoc" | "log">("dien");

  const [showSheet, setShowSheet] = useState(false);
  const [showConfirmSheet, setShowConfirmSheet] = useState(false);

  const [dienInput, setDienInput] = useState("");
  const [nuocInput, setNuocInput] = useState("");
  const [noteInput, setNoteInput] = useState("");

  const [editing, setEditing] = useState<Reading | null>(null);
  const isEditing = !!editing;

  // saving = only block while confirm button is being handled (very short)
  const [saving, setSaving] = useState(false);

  // syncing = background network syncing; DOES NOT block taps/edits
  const [syncing, setSyncing] = useState(false);

  const [msg, setMsg] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // log state
  const [loadingLog, setLoadingLog] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logErr, setLogErr] = useState<string | null>(null);

  const TTL_MS = 2 * 60 * 1000;

  // sync control
  const syncTimerRef = useRef<number | null>(null);
  const syncSeqRef = useRef(0);
  const syncingRef = useRef(false);

  // outbox control
  const flushingDeletesRef = useRef(false);
  const flushingWritesRef = useRef(false);

  function setSyncingSafe(v: boolean) {
    syncingRef.current = v;
    setSyncing(v);
  }

  function showToast(msgText: string, ms = 1300) {
    setToast(msgText);
    window.setTimeout(() => setToast((t) => (t === msgText ? null : t)), ms);
  }

  function sortNewestFirst(list: Reading[]) {
    const next = Array.isArray(list) ? list.slice() : [];
    next.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
    return next;
  }

  const latestCycle = useMemo(() => {
    if (!cycleMonth) return null;
    const list = sortNewestFirst(history);
    for (const r of list) {
      if (isRowInCycle(r, cycleMonth)) return r;
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, cycleMonth]);

  function loadFromCaches() {
    if (!room || !house) return;

    // cycle cache
    const cachedCycle = safeJsonParse<CacheEnvelope<string>>(
      localStorage.getItem(cycleKey()),
    );
    if (cachedCycle?.data) setCycleMonth(String(cachedCycle.data));
    setLoadingCycle(false);

    // overall latest (used only for "Last recorded" text)
    const cachedLatest = safeJsonParse<CacheEnvelope<Reading[]>>(
      localStorage.getItem(latestKey(house)),
    );
    const foundLatest =
      cachedLatest?.data?.find((x) => x.room === room) || null;
    setLatestOverall(foundLatest);

    // history
    setLoadingHistory(true);
    const cachedHist = safeJsonParse<CacheEnvelope<Record<string, Reading[]>>>(
      localStorage.getItem(historyKey(house)),
    );
    const list = cachedHist?.data?.[room];
    setHistory(Array.isArray(list) ? list : []);
    setLoadingHistory(false);
  }

  async function backgroundRefreshIfStale() {
    if (!house) return;

    const cycleCache = safeJsonParse<CacheEnvelope<string>>(
      localStorage.getItem(cycleKey()),
    );
    const latestCache = safeJsonParse<CacheEnvelope<Reading[]>>(
      localStorage.getItem(latestKey(house)),
    );
    const histCache = safeJsonParse<CacheEnvelope<Record<string, Reading[]>>>(
      localStorage.getItem(historyKey(house)),
    );

    const cycleFresh =
      !!cycleCache?.savedAt && Date.now() - cycleCache.savedAt < TTL_MS;
    const latestFresh =
      !!latestCache?.savedAt && Date.now() - latestCache.savedAt < TTL_MS;

    const roomHist = histCache?.data?.[room];
    const histFresh =
      !!histCache?.savedAt &&
      Date.now() - histCache.savedAt < TTL_MS &&
      Array.isArray(roomHist) &&
      roomHist.length > 0;

    if (cycleFresh && latestFresh && histFresh) return;

    try {
      setLoadingCycle(true);

      if (!cycleFresh) {
        const c = await fetch(`/api/meter?action=cycleGet`);
        const cj = await c.json();
        const cm = cj && cj.ok && typeof cj.data === "string" ? cj.data : null;
        if (cm) {
          setCycleMonth(cm);
          localStorage.setItem(
            cycleKey(),
            JSON.stringify({ savedAt: Date.now(), data: cm }),
          );
        }
      }

      if (!latestFresh) {
        const r1 = await fetch(
          `/api/meter?action=houseLatest&house=${encodeURIComponent(house)}`,
        );
        const j1 = await r1.json();
        const arr: Reading[] = Array.isArray(j1?.data) ? j1.data : [];
        localStorage.setItem(
          latestKey(house),
          JSON.stringify({ savedAt: Date.now(), data: arr }),
        );
      }

      if (!histFresh) {
        const r2 = await fetch(
          `/api/meter?action=houseHistory&house=${encodeURIComponent(
            house,
          )}&limitPerRoom=24`,
        );
        const j2 = await r2.json();
        const data: Record<string, Reading[]> =
          j2 && j2.ok && j2.data ? j2.data : {};
        localStorage.setItem(
          historyKey(house),
          JSON.stringify({ savedAt: Date.now(), data }),
        );
      }

      loadFromCaches();
    } catch (e) {
      console.log("backgroundRefreshIfStale failed", e);
    } finally {
      setLoadingCycle(false);
    }
  }

  async function refreshOverallLatestFromNetwork() {
    if (!room) return;
    try {
      const latestRes = await fetch(
        `/api/meter?room=${encodeURIComponent(room)}&action=latest`,
      );
      const latestJson = await latestRes.json();
      const latestData: Reading | null = latestJson?.data || null;

      setLatestOverall(latestData);
      if (latestData && house) upsertHouseLatestCache(house, latestData);
    } catch {
      // ignore
    }
  }

  async function refreshHistoryFromNetwork() {
    if (!room) return;
    try {
      const r = await fetch(
        `/api/meter?room=${encodeURIComponent(room)}&action=history&limit=24`,
      );
      const j = await r.json();
      const arr: Reading[] = Array.isArray(j?.data) ? j.data : [];
      const sorted = sortNewestFirst(arr).slice(0, 24);

      setHistory(sorted);
      if (house) writeHouseHistoryRoomListToCache(house, room, sorted);
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
        `/api/meter?action=log&room=${encodeURIComponent(room)}&limit=200`,
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

  async function flushWriteOutbox() {
    if (flushingWritesRef.current) return;
    flushingWritesRef.current = true;

    try {
      const pin = (sessionStorage.getItem("vtpt_pin") || "").trim();
      if (!pin) return;

      let list = readWriteOutbox();
      if (!list.length) return;

      // process oldest first (more fair)
      list = list.slice().reverse();

      for (const item of list) {
        try {
          const res = await fetch("/api/meter", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-vtpt-pin": pin,
            },
            body: JSON.stringify(item.payload),
            keepalive: true,
          });

          let j: any = null;
          try {
            j = await res.json();
          } catch {
            // ignore
          }

          if (j?.ok) {
            const now = readWriteOutbox();
            const next = now.filter(
              (x) => !(x.kind === "write" && x.id === item.id),
            );
            writeWriteOutbox(next);
          } else {
            const now = readWriteOutbox();
            const next = now.map((x) => {
              if (x.kind === "write" && x.id === item.id) {
                return { ...x, tries: (x.tries || 0) + 1 };
              }
              return x;
            });
            writeWriteOutbox(next);
          }
        } catch {
          const now = readWriteOutbox();
          const next = now.map((x) => {
            if (x.kind === "write" && x.id === item.id) {
              return { ...x, tries: (x.tries || 0) + 1 };
            }
            return x;
          });
          writeWriteOutbox(next);
        }
      }
    } finally {
      flushingWritesRef.current = false;
    }
  }

  async function flushDeleteOutbox() {
    if (flushingDeletesRef.current) return;
    flushingDeletesRef.current = true;

    try {
      const pin = (sessionStorage.getItem("vtpt_pin") || "").trim();
      if (!pin) return;

      let list = readDeleteOutbox();
      if (!list.length) return;

      // process oldest first (more fair)
      list = list.slice().reverse();

      for (const item of list) {
        try {
          const res = await fetch("/api/meter", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-vtpt-pin": pin,
            },
            body: JSON.stringify({
              action: "delete",
              room: item.room,
              target: item.target,
            }),
            keepalive: true,
          });

          let j: any = null;
          try {
            j = await res.json();
          } catch {
            // ignore
          }

          if (j?.ok) {
            // remove from outbox
            const now = readDeleteOutbox();
            const next = now.filter(
              (x) =>
                !(
                  x.kind === "delete" &&
                  x.room === item.room &&
                  x.target.id === item.target.id &&
                  x.target.date === item.target.date
                ),
            );
            writeDeleteOutbox(next);
          } else {
            // bump tries + keep
            const now = readDeleteOutbox();
            const next = now.map((x) => {
              if (
                x.kind === "delete" &&
                x.room === item.room &&
                x.target.id === item.target.id &&
                x.target.date === item.target.date
              ) {
                return { ...x, tries: (x.tries || 0) + 1 };
              }
              return x;
            });
            writeDeleteOutbox(next);
          }
        } catch {
          // bump tries + keep
          const now = readDeleteOutbox();
          const next = now.map((x) => {
            if (
              x.kind === "delete" &&
              x.room === item.room &&
              x.target.id === item.target.id &&
              x.target.date === item.target.date
            ) {
              return { ...x, tries: (x.tries || 0) + 1 };
            }
            return x;
          });
          writeDeleteOutbox(next);
        }
      }
    } finally {
      flushingDeletesRef.current = false;
    }
  }

  function scheduleSyncSoon() {
    if (syncTimerRef.current) {
      window.clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    syncTimerRef.current = window.setTimeout(() => {
      void runBackgroundSync();
    }, 450);
  }

  async function runBackgroundSync() {
    const mySeq = ++syncSeqRef.current;
    setSyncingSafe(true);

    try {
      // ✅ first: flush queued writes & deletes (survives fast navigation/offline)
      await flushWriteOutbox();
      await flushDeleteOutbox();

      await Promise.all([
        refreshOverallLatestFromNetwork(),
        refreshHistoryFromNetwork(),
      ]);
      if (tab === "log") await refreshLogFromNetwork();

      // ignore stale runs
      if (mySeq !== syncSeqRef.current) return;

      setSyncingSafe(false);
      showToast("Synced ✅", 900);
    } catch {
      if (mySeq !== syncSeqRef.current) return;
      setSyncingSafe(false);
      showToast("Sync failed ⚠️", 1200);
    }
  }

  function closeEditSheet() {
    if (saving) return;
    setShowSheet(false);
    setEditing(null);
    setMsg(null);
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

    setSyncingSafe(false);
    if (syncTimerRef.current) {
      window.clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    syncSeqRef.current = 0;

    loadFromCaches();
    backgroundRefreshIfStale();

    // ✅ If user saved/deleted + navigated fast earlier, retry now.
    // (No UI blocking. Worst case it fails and stays queued.)
    void flushWriteOutbox();
    void flushDeleteOutbox();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, house]);

  // ✅ NEW: auto-flush when network comes back or when tab becomes visible again
  useEffect(() => {
    function onOnline() {
      // Don’t block UI; just nudge sync.
      if (!room) return;
      setSyncingSafe(true);
      void flushWriteOutbox();
      void flushDeleteOutbox();
      scheduleSyncSoon();
    }

    function onVisibility() {
      if (document.visibilityState !== "visible") return;
      if (!room) return;

      // If there’s anything pending, flush it.
      const hasPending =
        readWriteOutbox().length > 0 || readDeleteOutbox().length > 0;
      if (!hasPending) return;

      setSyncingSafe(true);
      void flushWriteOutbox();
      void flushDeleteOutbox();
      scheduleSyncSoon();
    }

    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

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

  const hasThisCycle = isRowInCycle(latestCycle, cycleMonth);

  const buttonLabel = "Record";

  function openSheet() {
    setMsg(null);
    setEditing(null);
    setShowConfirmSheet(false);
    setShowSheet(true);

    const base = hasThisCycle ? latestCycle : null;

    if (base) {
      setDienInput(
        typeof base.dien === "number" && Number.isFinite(base.dien)
          ? String(base.dien)
          : "",
      );
      setNuocInput(
        typeof base.nuoc === "number" && Number.isFinite(base.nuoc)
          ? String(base.nuoc)
          : "",
      );
      setNoteInput(String(base.note ?? ""));
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
        : "",
    );
    setNuocInput(
      typeof r.nuoc === "number" && Number.isFinite(r.nuoc)
        ? String(r.nuoc)
        : "",
    );
    setNoteInput(String(r.note ?? ""));
  }

  // IMPORTANT: do NOT block taps while syncing. only block while saving click is processed.
  const canTapCard = !saving && !!room && !!house;

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

    const nowIso = new Date().toISOString();

    const baseSameDayRow =
      !isEditing && hasThisCycle && latestCycle && latestCycle.date
        ? isSameVNDay(latestCycle.date, nowIso)
          ? latestCycle
          : null
        : null;

    const willUpdate = isEditing || !!baseSameDayRow;

    const targetForUpdate =
      isEditing && editing
        ? { id: editing.id, date: editing.date }
        : baseSameDayRow
          ? { id: baseSameDayRow.id, date: baseSameDayRow.date }
          : undefined;

    const tempId = -Date.now();
    const optimisticCycle = cycleMonth || undefined;

    const optimistic: Reading = {
      room,
      date: willUpdate
        ? isEditing && editing
          ? editing.date
          : baseSameDayRow!.date
        : nowIso,
      id: willUpdate
        ? isEditing && editing
          ? editing.id
          : baseSameDayRow!.id
        : tempId,
      dien: dienNum,
      nuoc: nuocNum,
      note: noteInput.trim(),
      cycle: optimisticCycle,
    };

    // ✅ instant UI update
    if (house) {
      if (willUpdate && targetForUpdate) {
        setHistory((prev) => {
          const replaced = prev.map((x) =>
            x.id === targetForUpdate.id && x.date === targetForUpdate.date
              ? { ...x, ...optimistic }
              : x,
          );
          const next = sortNewestFirst(replaced).slice(0, 24);
          writeHouseHistoryRoomListToCache(house, room, next);
          return next;
        });
      } else {
        setHistory((prev) => {
          const next = [optimistic, ...prev].slice(0, 24);
          writeHouseHistoryRoomListToCache(house, room, next);
          return next;
        });
      }

      // House page is driven by vtpt_houseLatest cache: update it immediately
      upsertHouseLatestCache(house, optimistic);

      // (optional) also keep per-room history cache consistent
      upsertHouseHistoryCache(house, optimistic, 24);
    }

    setEditing(null);
    setShowSheet(false);
    setShowConfirmSheet(false);

    showToast("Saved ✅", 900);

    // ✅ enqueue write so it survives offline / fast navigation
    const action: WriteAction = willUpdate ? "update" : "save";
    enqueueWrite({
      action,
      room,
      dien: dienNum,
      nuoc: nuocNum,
      note: noteInput.trim(),
      target: willUpdate ? targetForUpdate : undefined,
    });

    // ✅ background sync indicator (but do not block user)
    setSyncingSafe(true);
    window.setTimeout(() => {
      if (syncingRef.current) setToast("Syncing…");
    }, 350);

    // Best effort immediate flush (queue is the guarantee)
    void flushWriteOutbox();

    // Then do a truth sync soon (history/latest) to pull real IDs/stamps
    scheduleSyncSoon();

    setSaving(false);
  }

  async function deleteEditingRow() {
    if (!editing || saving) return;

    const ok = window.confirm("Delete this reading? This can't be undone.");
    if (!ok) return;

    setSaving(true);

    const deleting = editing;
    const target = { id: deleting.id, date: deleting.date };

    // close UI immediately
    setShowSheet(false);
    setShowConfirmSheet(false);
    setEditing(null);
    setMsg(null);

    // optimistic remove
    const nextHistory = sortNewestFirst(
      history.filter(
        (x) => !(x.id === deleting.id && x.date === deleting.date),
      ),
    ).slice(0, 24);

    setHistory(nextHistory);
    if (house) writeHouseHistoryRoomListToCache(house, room, nextHistory);

    // If the cached "latest for house page" was this exact row, remove it now.
    // (Then the next sync will repopulate truth.)
    if (house) removeHouseLatestIfMatch(house, room, target);

    // If our "Last recorded" was this exact row, clear it now (avoid showing ghost info).
    if (
      latestOverall &&
      latestOverall.id === target.id &&
      latestOverall.date === target.date
    ) {
      setLatestOverall(null);
    }

    showToast("Deleted ✅", 900);

    // ✅ IMPORTANT: queue the delete so it survives fast navigation
    enqueueDelete(room, target);

    // Start syncing indicator (but do not block user)
    setSyncingSafe(true);
    window.setTimeout(() => {
      if (syncingRef.current) setToast("Syncing…");
    }, 350);

    // Fire immediately (best effort), but the queue is the real guarantee
    void flushDeleteOutbox();

    // Then do a truth sync soon (history/latest)
    scheduleSyncSoon();

    setSaving(false);
  }

  const overallLatestDate = useMemo(() => {
    if (!latestOverall?.date) return null;
    const d = new Date(latestOverall.date);
    return isNaN(d.getTime()) ? null : d;
  }, [latestOverall]);

  const historyRows = useMemo(() => {
    const list = Array.isArray(history) ? sortNewestFirst(history) : [];

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

  const showCycleNumbers = hasThisCycle;

  const latestDien =
    showCycleNumbers &&
    latestCycle &&
    typeof latestCycle.dien === "number" &&
    Number.isFinite(latestCycle.dien)
      ? latestCycle.dien
      : null;

  const latestNuoc =
    showCycleNumbers &&
    latestCycle &&
    typeof latestCycle.nuoc === "number" &&
    Number.isFinite(latestCycle.nuoc)
      ? latestCycle.nuoc
      : null;

  const confirmDien = parseOptionalNumberFromInput(dienInput);
  const confirmNuoc = parseOptionalNumberFromInput(nuocInput);

  const topReady = !loadingHistory && !loadingCycle;

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
            {overallLatestDate
              ? `Last recorded: ${formatDateTime(overallLatestDate)}`
              : "No record yet"}
            <span style={{ marginLeft: 8, opacity: 0.55 }}>
              {loadingCycle
                ? "• Cycle …"
                : cycleMonth
                  ? `• Cycle ${cycleMonth}`
                  : "• Cycle —"}
            </span>
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
              opacity: syncing ? 0.9 : 1,
            }}
          >
            {syncing ? "Syncing…" : toast}
          </div>
        )}
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={{ fontSize: 16, fontWeight: 800, opacity: 0.75 }}>
          Current cycle reading
        </div>

        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
          <div
            onClick={() => canTapCard && openSheet()}
            onKeyDown={(e) => {
              if (!canTapCard) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openSheet();
              }
            }}
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
              {!topReady ? "…" : latestDien === null ? "— — —" : latestDien}
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
              {!topReady ? "…" : latestNuoc === null ? "— — —" : latestNuoc}
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
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}
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

      {/* Confirm Sheet (Step 2) */}
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
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}
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
                padding: 13,
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
