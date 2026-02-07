// pages/house/[house].tsx
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import { getRoomsByHouse, RoomsByHouse } from "../../lib/rooms";
import { useCycle } from "../../lib/useCycle";

type Reading = {
  room: string;
  date: string;
  dien: number | null;
  nuoc: number | null;
  id: number;
  note?: string;
};

type CacheEnvelope<T> = { savedAt: number; data: T };

const TZ = "Asia/Ho_Chi_Minh";

// Your business rule: worker usually records near end of month for next cycle.
// If date-of-month >= CYCLE_ROLLOVER_DAY, treat as next month.
const CYCLE_ROLLOVER_DAY = 25;

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

function timeText(ms?: number) {
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString();
}

function displayMeter(v: number | null | undefined) {
  return v === null || v === undefined ? "---" : String(v);
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function monthKeyFromParts(y: number, m: number) {
  return `${y}-${pad2(m)}`;
}

function isMonthKey(s: string) {
  return /^\d{4}-\d{2}$/.test((s || "").trim());
}

/* ===== month key (VN timezone) ===== */

function monthKeyVN(date = new Date()) {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
    });
    const parts = fmt.formatToParts(date);
    const y = Number(parts.find((p) => p.type === "year")?.value || "");
    const m = Number(parts.find((p) => p.type === "month")?.value || "");
    if (Number.isFinite(y) && Number.isFinite(m) && m >= 1 && m <= 12) {
      return monthKeyFromParts(y, m);
    }
  } catch {
    // ignore
  }
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

function monthKeyFromDateStringVN(dateStr: string) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "unknown";
  return monthKeyVN(d);
}

function currentMonthKeyVN() {
  return monthKeyVN(new Date());
}

/* ===== VN date parts helper ===== */

function vnYMD(dateStr: string): { y: number; m: number; d: number } | null {
  const dt = new Date(dateStr);
  if (Number.isNaN(dt.getTime())) return null;

  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = fmt.formatToParts(dt);
    const y = Number(parts.find((p) => p.type === "year")?.value || "");
    const m = Number(parts.find((p) => p.type === "month")?.value || "");
    const d = Number(parts.find((p) => p.type === "day")?.value || "");
    if (
      Number.isFinite(y) &&
      Number.isFinite(m) &&
      Number.isFinite(d) &&
      m >= 1 &&
      m <= 12 &&
      d >= 1 &&
      d <= 31
    ) {
      return { y, m, d };
    }
  } catch {
    // ignore
  }

  // fallback: local parse
  const y = dt.getFullYear();
  const m = dt.getMonth() + 1;
  const d = dt.getDate();
  if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
    return { y, m, d };
  }
  return null;
}

function nextMonthKey(key: string) {
  if (!isMonthKey(key)) return key;
  const [yy, mm] = key.split("-").map(Number);
  const d = new Date(yy, (mm || 1) - 1, 1);
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

/**
 * Map a reading's physical date -> the BUSINESS cycle month it should count for.
 * Rule:
 * - if recorded on/after day CYCLE_ROLLOVER_DAY, treat as next month cycle
 * - else treat as same month
 */
function cycleKeyFromReadingDate(dateStr: string): string | null {
  const parts = vnYMD(dateStr);
  if (!parts) return null;

  const mk = monthKeyFromParts(parts.y, parts.m);
  if (!isMonthKey(mk)) return null;

  if (parts.d >= CYCLE_ROLLOVER_DAY) {
    return nextMonthKey(mk);
  }
  return mk;
}

/* ===== monthly status helpers (cycle-driven) ===== */

function isResolvedNote(note?: string) {
  if (!note) return false;
  return /\bresolved\b/i.test(note);
}

function hasUnresolvedNote(reading?: Reading) {
  const note = reading?.note?.trim();
  if (!note) return false;
  return !isResolvedNote(note);
}

/**
 * New: cycle-aware check using your real-world collection window.
 * This makes:
 * - Jan 28 reading count for Feb cycle
 * - Feb 28 reading count for Mar cycle
 */
function isLoggedInBusinessCycle(
  reading: Reading | undefined,
  cycleKey: string,
) {
  if (!reading?.date) return false;

  const ck = (cycleKey || "").trim();
  if (!ck || !isMonthKey(ck)) return false;

  const effective = cycleKeyFromReadingDate(reading.date);
  if (!effective || !isMonthKey(effective)) return false;

  return effective === ck;
}

/* =================================== */

export default function HousePage() {
  const router = useRouter();
  const house = (router.query.house as string) || "";

  const [mounted, setMounted] = useState(false);
  const [rooms, setRooms] = useState<string[]>([]);
  const [latestMap, setLatestMap] = useState<Record<string, Reading>>({});
  const [loading, setLoading] = useState(true);

  const [houseHistory, setHouseHistory] = useState<Record<string, Reading[]>>(
    {},
  );

  const [status, setStatus] = useState<string>("");

  // shared cycle cache + background refresh
  const { cycle, loading: cycleLoading, refresh: refreshCycle } = useCycle();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!house) return;

    // 1) build rooms list
    const all: RoomsByHouse = getRoomsByHouse();
    const list = all[house] || [];
    setRooms(list);

    // 2) load caches (for offline + quick paint)
    const cachedLatest = safeJsonParse<CacheEnvelope<Reading[]>>(
      localStorage.getItem(latestKey(house)),
    );

    if (cachedLatest?.data?.length) {
      const m: Record<string, Reading> = {};
      cachedLatest.data.forEach((r) => (m[r.room] = r));
      setLatestMap(m);
    } else {
      setLatestMap({});
    }

    const cachedHist = safeJsonParse<CacheEnvelope<Record<string, Reading[]>>>(
      localStorage.getItem(historyKey(house)),
    );

    if (cachedHist?.data) setHouseHistory(cachedHist.data || {});
    else setHouseHistory({});

    const latestStamp = cachedLatest?.savedAt;
    const histStamp = cachedHist?.savedAt;

    if (latestStamp || histStamp) {
      setStatus(
        `Cached: latest ${
          latestStamp ? timeText(latestStamp) : "—"
        } • history ${histStamp ? timeText(histStamp) : "—"}`,
      );
    } else {
      setStatus("No cache yet");
    }

    // 3) Sync shared cycle (fast if cached)
    void refreshCycle();

    // 4) fetch fresh in background
    (async () => {
      setLoading(true);
      try {
        const r1 = await fetch(
          `/api/meter?action=houseLatest&house=${encodeURIComponent(house)}`,
          { cache: "no-store" },
        );
        const j1 = await r1.json();
        const arr: Reading[] = Array.isArray(j1.data) ? j1.data : [];

        const m: Record<string, Reading> = {};
        arr.forEach((x) => (m[x.room] = x));
        setLatestMap(m);

        localStorage.setItem(
          latestKey(house),
          JSON.stringify({ savedAt: Date.now(), data: arr }),
        );

        const r2 = await fetch(
          `/api/meter?action=houseHistory&house=${encodeURIComponent(
            house,
          )}&limitPerRoom=24`,
          { cache: "no-store" },
        );
        const j2 = await r2.json();
        const hist: Record<string, Reading[]> =
          j2 && j2.ok && j2.data ? j2.data : {};

        setHouseHistory(hist);

        localStorage.setItem(
          historyKey(house),
          JSON.stringify({ savedAt: Date.now(), data: hist }),
        );

        // re-sync cycle after network calls too (in case approve happened elsewhere)
        await refreshCycle();

        setStatus(`Updated (${new Date().toLocaleTimeString()})`);
      } catch {
        setStatus(`Fetch failed (using cache)`);
        // still try to sync cycle (might fail offline)
        await refreshCycle();
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [house]);

  const title = useMemo(() => (house ? `House ${house}` : "House"), [house]);

  // SSR-safe label: show "…" until mounted; after that, show cached cycle if available.
  const effectiveCycleKey = useMemo(() => {
    if (!mounted) return "…";
    if (cycleLoading) return "…";
    const k = (cycle || "").trim();
    if (k && isMonthKey(k)) return k;
    return "…";
  }, [mounted, cycleLoading, cycle]);

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
          onClick={() => router.push("/")}
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
          <div style={{ fontSize: 20, fontWeight: 900 }}>{title}</div>
          <div style={{ fontSize: 12, opacity: 0.6 }}>
            {loading ? "Refreshing…" : status}
          </div>
          <div style={{ fontSize: 11, opacity: 0.45, marginTop: 2 }}>
            Cycle month: {effectiveCycleKey}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
        {rooms.map((room) => {
          const latest = latestMap[room];

          const loggedInCycle =
            mounted && effectiveCycleKey !== "…"
              ? isLoggedInBusinessCycle(latest, effectiveCycleKey)
              : false;

          const unresolvedNote = loggedInCycle && hasUnresolvedNote(latest);

          const iconSrc = !loggedInCycle
            ? null
            : unresolvedNote
              ? "/icons/warning.png"
              : "/icons/check.png";

          const iconAlt = !loggedInCycle
            ? ""
            : unresolvedNote
              ? "Has note"
              : "Logged";

          const dienDisplay = loggedInCycle
            ? displayMeter(latest?.dien)
            : "---";
          const nuocDisplay = loggedInCycle
            ? displayMeter(latest?.nuoc)
            : "---";

          return (
            <Link
              key={room}
              href={`/room/${encodeURIComponent(
                room,
              )}?house=${encodeURIComponent(house)}`}
              style={{
                display: "grid",
                gridTemplateColumns: "1.2fr 1fr 1fr",
                gap: 10,
                padding: 14,
                borderRadius: 14,
                border: "1px solid #e5e5e5",
                textDecoration: "none",
                color: "inherit",
                background: "#fff",
                alignItems: "center",
              }}
            >
              <div style={{ fontWeight: 900 }}>
                {iconSrc ? (
                  <img
                    src={iconSrc}
                    alt={iconAlt}
                    style={{
                      width: 22,
                      height: 22,
                      marginRight: 6,
                      verticalAlign: "middle",
                    }}
                  />
                ) : null}
                {room}
              </div>

              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 12, opacity: 0.55, fontWeight: 800 }}>
                  Điện
                </div>
                <div style={{ fontWeight: 900 }}>{dienDisplay}</div>
              </div>

              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 12, opacity: 0.55, fontWeight: 800 }}>
                  Nước
                </div>
                <div style={{ fontWeight: 900 }}>{nuocDisplay}</div>
              </div>
            </Link>
          );
        })}
      </div>

      <div style={{ marginTop: 14, fontSize: 12, opacity: 0.5 }}>
        History cached rooms: {Object.keys(houseHistory || {}).length}
      </div>

      <div style={{ marginTop: 8, fontSize: 11, opacity: 0.4 }}>
        Cycle rollover day: {CYCLE_ROLLOVER_DAY} (end-of-month readings count
        for next cycle)
      </div>
    </main>
  );
}
