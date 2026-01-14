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

/* ===== monthly status helpers ===== */

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function isLoggedThisMonth(reading?: Reading) {
  if (!reading?.date) return false;
  const parsed = new Date(reading.date);
  if (Number.isNaN(parsed.getTime())) return false;
  return monthKey(parsed) === monthKey(new Date());
}

// note exists AND is not marked resolved
function hasUnresolvedNote(reading?: Reading) {
  const note = reading?.note?.trim();
  if (!note) return false;
  // "resolved" anywhere (case-insensitive) -> treat as resolved
  return !/\bresolved\b/i.test(note);
}

/* =================================== */

export default function HousePage() {
  const router = useRouter();
  const house = (router.query.house as string) || "";

  const [rooms, setRooms] = useState<string[]>([]);
  const [latestMap, setLatestMap] = useState<Record<string, Reading>>({});
  const [loading, setLoading] = useState(true);

  const [houseHistory, setHouseHistory] = useState<Record<string, Reading[]>>(
    {}
  );

  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    if (!house) return;

    // 1) build rooms list
    const all: RoomsByHouse = getRoomsByHouse();
    const list = all[house] || [];
    setRooms(list);

    // 2) load cached latest
    const cachedLatest = safeJsonParse<CacheEnvelope<Reading[]>>(
      localStorage.getItem(latestKey(house))
    );

    if (cachedLatest?.data?.length) {
      const m: Record<string, Reading> = {};
      cachedLatest.data.forEach((r) => (m[r.room] = r));
      setLatestMap(m);
    } else {
      setLatestMap({});
    }

    // 2b) load cached history
    const cachedHist = safeJsonParse<CacheEnvelope<Record<string, Reading[]>>>(
      localStorage.getItem(historyKey(house))
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
        } • history ${histStamp ? timeText(histStamp) : "—"}`
      );
    } else {
      setStatus("No cache yet");
    }

    // 3) fetch fresh in background
    (async () => {
      setLoading(true);
      try {
        const r1 = await fetch(
          `/api/meter?action=houseLatest&house=${encodeURIComponent(house)}`
        );
        const j1 = await r1.json();
        const arr: Reading[] = Array.isArray(j1.data) ? j1.data : [];

        const m: Record<string, Reading> = {};
        arr.forEach((x) => (m[x.room] = x));
        setLatestMap(m);

        localStorage.setItem(
          latestKey(house),
          JSON.stringify({ savedAt: Date.now(), data: arr })
        );

        const r2 = await fetch(
          `/api/meter?action=houseHistory&house=${encodeURIComponent(
            house
          )}&limitPerRoom=24`
        );
        const j2 = await r2.json();
        const hist: Record<string, Reading[]> =
          j2 && j2.ok && j2.data ? j2.data : {};

        setHouseHistory(hist);

        localStorage.setItem(
          historyKey(house),
          JSON.stringify({ savedAt: Date.now(), data: hist })
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
        </div>
      </div>

      <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
        {rooms.map((room) => {
          const latest = latestMap[room];
          const loggedThisMonth = isLoggedThisMonth(latest);
          const unresolvedNote = loggedThisMonth && hasUnresolvedNote(latest);

          // ✅ IMPORTANT: If not logged this month, show empty meters on house list
          const dienDisplay = loggedThisMonth
            ? displayMeter(latest?.dien)
            : "---";
          const nuocDisplay = loggedThisMonth
            ? displayMeter(latest?.nuoc)
            : "---";

          return (
            <Link
              key={room}
              href={`/room/${encodeURIComponent(
                room
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
                {loggedThisMonth ? (
                  <>
                    <img
                      src="/icons/check.png"
                      alt="Logged"
                      style={{
                        width: 22,
                        height: 22,
                        marginRight: 6,
                        verticalAlign: "middle",
                      }}
                    />
                    {unresolvedNote ? (
                      <img
                        src="/icons/warning.png"
                        alt="Has note"
                        style={{
                          width: 22,
                          height: 22,
                          marginRight: 6,
                          verticalAlign: "middle",
                        }}
                      />
                    ) : null}
                  </>
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
