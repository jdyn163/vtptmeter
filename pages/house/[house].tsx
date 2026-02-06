import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import { getRoomsByHouse, RoomsByHouse } from "../../lib/rooms";

type Reading = {
  room: string;
  date: string;
  dien: number | null;
  nuoc: number | null;
  id: number;
  note?: string;
};

type CacheEnvelope<T> = { savedAt: number; data: T };

const CYCLE_KEY = "vtpt_cycle_month";
const TZ = "Asia/Ho_Chi_Minh";

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

/* ===== monthly status helpers (approval-driven cycle) ===== */

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
    // fall through
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

function readCycleKeyFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = (localStorage.getItem(CYCLE_KEY) || "").trim();
    if (!raw.length) return null;
    return isMonthKey(raw) ? raw : null;
  } catch {
    return null;
  }
}

function computeEffectiveCycleKey(latestMap: Record<string, Reading>) {
  const stored = readCycleKeyFromStorage();
  if (stored) return stored;

  // If no stored cycle yet, anchor to the newest reading month across rooms
  // (keeps last month visible until admin presses Approve).
  let newestISO: string | null = null;
  for (const r of Object.values(latestMap || {})) {
    if (!r?.date) continue;
    if (!newestISO) newestISO = r.date;
    else {
      const a = new Date(r.date).getTime();
      const b = new Date(newestISO).getTime();
      if (!Number.isNaN(a) && (Number.isNaN(b) || a > b)) newestISO = r.date;
    }
  }

  if (newestISO) {
    const mk = monthKeyFromDateStringVN(newestISO);
    if (mk && mk !== "unknown") return mk;
  }

  return currentMonthKeyVN();
}

function isLoggedInCycleMonth(reading: Reading | undefined, cycleKey: string) {
  if (!reading?.date) return false;
  const mk = monthKeyFromDateStringVN(reading.date);
  if (!mk || mk === "unknown") return false;
  return mk === cycleKey;
}

function isResolvedNote(note?: string) {
  if (!note) return false;
  return /\bresolved\b/i.test(note);
}

function hasAnyNote(reading?: Reading) {
  const note = reading?.note?.trim();
  return !!note;
}

function hasUnresolvedNote(reading?: Reading) {
  const note = reading?.note?.trim();
  if (!note) return false;
  return !isResolvedNote(note);
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

  // approval-driven cycle month key (global)
  const [cycleKey, setCycleKey] = useState<string>("");

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!house) return;

    // 1) build rooms list
    const all: RoomsByHouse = getRoomsByHouse();
    const list = all[house] || [];
    setRooms(list);

    // preload cycle key (client-only)
    setCycleKey(readCycleKeyFromStorage() || "");

    // 2) load cached latest
    const cachedLatest = safeJsonParse<CacheEnvelope<Reading[]>>(
      localStorage.getItem(latestKey(house)),
    );

    if (cachedLatest?.data?.length) {
      const m: Record<string, Reading> = {};
      cachedLatest.data.forEach((r) => (m[r.room] = r));
      setLatestMap(m);

      // if cycle key not set, anchor it to newest cached
      if (!readCycleKeyFromStorage()) {
        setCycleKey(computeEffectiveCycleKey(m));
      }
    } else {
      setLatestMap({});
    }

    // 2b) load cached history
    const cachedHist = safeJsonParse<CacheEnvelope<Record<string, Reading[]>>>(
      localStorage.getItem(historyKey(house)),
    );

    if (cachedHist?.data) {
      setHouseHistory(cachedHist.data || {});
    } else {
      setHouseHistory({});
    }

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

    // 3) fetch fresh in background
    (async () => {
      setLoading(true);
      try {
        const r1 = await fetch(
          `/api/meter?action=houseLatest&house=${encodeURIComponent(house)}`,
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

        // compute effective cycle key (stored wins, otherwise newest reading month)
        setCycleKey(computeEffectiveCycleKey(m));

        const r2 = await fetch(
          `/api/meter?action=houseHistory&house=${encodeURIComponent(
            house,
          )}&limitPerRoom=24`,
        );
        const j2 = await r2.json();
        const hist: Record<string, Reading[]> =
          j2 && j2.ok && j2.data ? j2.data : {};

        setHouseHistory(hist);

        localStorage.setItem(
          historyKey(house),
          JSON.stringify({ savedAt: Date.now(), data: hist }),
        );

        setStatus(`Updated (${new Date().toLocaleTimeString()})`);
      } catch {
        setStatus(`Fetch failed (using cache)`);
      } finally {
        setLoading(false);
      }
    })();
  }, [house]);

  const title = useMemo(() => (house ? `House ${house}` : "House"), [house]);

  const effectiveCycleKey = useMemo(() => {
    if (!mounted) return "…";
    const computed = cycleKey?.trim();
    if (computed && isMonthKey(computed)) return computed;
    return computeEffectiveCycleKey(latestMap);
  }, [mounted, cycleKey, latestMap]);

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
              ? isLoggedInCycleMonth(latest, effectiveCycleKey)
              : false;

          const showAnyIcon = loggedInCycle;
          const unresolvedNote = loggedInCycle && hasUnresolvedNote(latest);

          const iconSrc = !showAnyIcon
            ? null
            : unresolvedNote
              ? "/icons/warning.png"
              : "/icons/check.png";

          const iconAlt = !showAnyIcon
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
    </main>
  );
}
