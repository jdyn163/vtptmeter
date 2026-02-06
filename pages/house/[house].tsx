// pages/house/[house].tsx
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

/* ===== Shared cycle (backend) ===== */

async function fetchBackendCycleKeySafe(): Promise<string | null> {
  try {
    const r = await fetch("/api/meter?action=cycleGet", {
      method: "GET",
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });
    const j = await r.json();

    const raw =
      typeof j?.data === "string"
        ? j.data
        : typeof j?.cycleMonthKey === "string"
          ? j.cycleMonthKey
          : typeof j?.month === "string"
            ? j.month
            : typeof j?.monthKey === "string"
              ? j.monthKey
              : typeof j?.current === "string"
                ? j.current
                : "";

    const key = String(raw || "").trim();
    return isMonthKey(key) ? key : null;
  } catch {
    return null;
  }
}

/* ===== monthly status helpers (cycle-driven) ===== */

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

  // Fix A: do not show cycle until backend answered at least once
  const [cycleKey, setCycleKey] = useState<string>(""); // last known backend cycle
  const [cycleLoaded, setCycleLoaded] = useState(false);

  async function syncCycle() {
    const backend = await fetchBackendCycleKeySafe();
    if (backend) {
      setCycleKey(backend);
      setCycleLoaded(true);
      return;
    }

    // Fix A rule:
    // - If never loaded before: keep it in "…" state (do NOT fallback for display).
    // - If loaded before: keep last known cycleKey (no flip).
    // (No state change needed.)
  }

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

    // 3) Always sync shared cycle first (single source of truth)
    void syncCycle();

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
        await syncCycle();

        setStatus(`Updated (${new Date().toLocaleTimeString()})`);
      } catch {
        setStatus(`Fetch failed (using cache)`);
        // still try to sync cycle (might fail offline)
        await syncCycle();
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [house]);

  const title = useMemo(() => (house ? `House ${house}` : "House"), [house]);

  // SSR-safe label + Fix A: only render cycle after cycleLoaded === true
  const effectiveCycleKey = useMemo(() => {
    if (!mounted) return "…";
    if (!cycleLoaded) return "…";
    const k = (cycleKey || "").trim();
    if (k && isMonthKey(k)) return k;
    return "…";
  }, [mounted, cycleLoaded, cycleKey]);

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
    </main>
  );
}
