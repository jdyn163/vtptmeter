import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useRef, useState } from "react";
import { getRoomsByHouse, RoomsByHouse } from "../../lib/rooms";

type Reading = {
  room: string;
  date: string;
  dien: number | null;
  nuoc: number | null;
  id: number;
  note?: string;
  cycle?: string; // from sheet "Cycle" column
};

type CacheEnvelope<T> = { savedAt: number; data: T };

function latestKey(house: string) {
  // cache for "cycle latest" list per room
  return `vtpt_houseLatest_${house}`;
}

function cycleKey() {
  return `vtpt_cycleMonth`;
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

/* ===== legacy fallback (only for old rows missing cycle) ===== */
function monthKeyFromDateString(dateStr: string) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "unknown";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function isRowInCycle(
  row: Reading | undefined | null,
  cycleMonth: string | null,
) {
  if (!row || !cycleMonth) return false;

  const rowCycle = String(row.cycle || "").trim();
  if (rowCycle) return rowCycle === cycleMonth;

  // fallback for legacy rows (Cycle blank): infer from Date month
  const mk = monthKeyFromDateString(row.date);
  return mk === cycleMonth;
}

/* ===== note helpers ===== */
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
/* ======================= */

export default function HousePage() {
  const router = useRouter();
  const house = (router.query.house as string) || "";

  const [rooms, setRooms] = useState<string[]>([]);
  const [latestMap, setLatestMap] = useState<Record<string, Reading>>({});

  const [cycleMonth, setCycleMonth] = useState<string | null>(null);

  const [loading, setLoading] = useState(true); // first paint only
  const [refreshing, setRefreshing] = useState(false); // background refresh
  const [status, setStatus] = useState<string>("");

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!house) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    // 1) rooms list
    const all: RoomsByHouse = getRoomsByHouse();
    const list = all[house] || [];
    setRooms(list);

    // 2) load caches immediately
    const cachedCycle = safeJsonParse<CacheEnvelope<string>>(
      localStorage.getItem(cycleKey()),
    );
    const cachedLatest = safeJsonParse<CacheEnvelope<Reading[]>>(
      localStorage.getItem(latestKey(house)),
    );

    if (cachedCycle?.data) setCycleMonth(String(cachedCycle.data));

    if (cachedLatest?.data?.length) {
      const m: Record<string, Reading> = {};
      cachedLatest.data.forEach((r) => (m[r.room] = r));
      setLatestMap(m);
    } else {
      setLatestMap({});
    }

    const cycleText = cachedCycle?.data
      ? `Cycle ${cachedCycle.data}`
      : "Cycle —";
    const latestStamp = cachedLatest?.savedAt;

    if (latestStamp || cachedCycle?.savedAt) {
      setStatus(
        `${cycleText} • Cached: latest ${latestStamp ? timeText(latestStamp) : "—"}`,
      );
    } else {
      setStatus(`${cycleText} • No cache yet`);
    }

    // first paint: if no cache at all, show "loading"
    const hasAnyCache = !!(cachedCycle?.data || cachedLatest?.data?.length);
    setLoading(!hasAnyCache);

    // 3) background refresh (FAST: only cycleGet + houseCycleLatest)
    (async () => {
      setRefreshing(true);

      try {
        // cycle first
        const c = await fetch(`/api/meter?action=cycleGet`, {
          signal: ac.signal,
        });
        const cj = await c.json();
        const cm = cj && cj.ok && typeof cj.data === "string" ? cj.data : null;

        if (cm) {
          setCycleMonth(cm);
          localStorage.setItem(
            cycleKey(),
            JSON.stringify({ savedAt: Date.now(), data: cm }),
          );
        }

        // cycle-latest per room (includes note)
        const r1 = await fetch(
          `/api/meter?action=houseCycleLatest&house=${encodeURIComponent(house)}`,
          { signal: ac.signal },
        );
        const j1 = await r1.json();
        const arr: Reading[] = Array.isArray(j1?.data) ? j1.data : [];

        const m: Record<string, Reading> = {};
        arr.forEach((x) => (m[x.room] = x));
        setLatestMap(m);

        localStorage.setItem(
          latestKey(house),
          JSON.stringify({ savedAt: Date.now(), data: arr }),
        );

        const cycleLabel = cm
          ? `Cycle ${cm}`
          : cycleMonth
            ? `Cycle ${cycleMonth}`
            : "Cycle —";
        setStatus(
          `${cycleLabel} • Updated (${new Date().toLocaleTimeString()})`,
        );
      } catch {
        const cycleLabel = cycleMonth ? `Cycle ${cycleMonth}` : "Cycle —";
        setStatus(`${cycleLabel} • Fetch failed (using cache)`);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    })();

    return () => {
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [house]);

  const title = useMemo(() => (house ? `House ${house}` : "House"), [house]);

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
            {loading ? "Loading…" : status}
            {refreshing && (
              <span style={{ marginLeft: 6, opacity: 0.6 }}>(refresh…)</span>
            )}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
        {rooms.map((room) => {
          const latest = latestMap[room];

          const loggedThisCycle = isRowInCycle(latest, cycleMonth);

          // rule:
          // - empty (no cycle row) => no icon + --- ---
          // - has row this cycle => green check
          // - has note and NOT resolved => yellow warning
          // - has note and resolved => green check
          const unresolvedNote = loggedThisCycle && hasUnresolvedNote(latest);
          const hasNote = loggedThisCycle && hasAnyNote(latest);

          const iconSrc = !loggedThisCycle
            ? null
            : unresolvedNote
              ? "/icons/warning.png"
              : "/icons/check.png";

          const iconAlt = !loggedThisCycle
            ? ""
            : unresolvedNote
              ? "Has note"
              : hasNote
                ? "Logged (note resolved)"
                : "Logged";

          const dienDisplay = loggedThisCycle
            ? displayMeter(latest?.dien)
            : "---";
          const nuocDisplay = loggedThisCycle
            ? displayMeter(latest?.nuoc)
            : "---";

          return (
            <Link
              key={room}
              href={`/room/${encodeURIComponent(room)}?house=${encodeURIComponent(house)}`}
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
    </main>
  );
}
