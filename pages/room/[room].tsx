import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";

type HistoryItem = {
  date: string;
  dien: number;
  nuoc: number;
  note?: string;
};

function houseLatestKey(house: string) {
  return `vtpt_houseLatest_${house}`;
}

function houseHistoryKey(house: string) {
  return `vtpt_houseHistory_${house}`;
}

export default function RoomPage() {
  const router = useRouter();
  const { room } = router.query as { room?: string };

  const [dien, setDien] = useState("");
  const [nuoc, setNuoc] = useState("");
  const [note, setNote] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const house = useMemo(() => {
    if (!room) return "";
    const idx = room.indexOf("-");
    return idx === -1 ? room : room.slice(0, idx);
  }, [room]);

  // =========================
  // Load cached history (safe)
  // =========================
  useEffect(() => {
    if (!house) return;

    try {
      const raw = localStorage.getItem(houseHistoryKey(house));
      if (!raw) {
        setHistory([]);
        return;
      }

      const parsed = JSON.parse(raw);

      // ✅ FIX: handle old cache shapes
      if (Array.isArray(parsed)) {
        setHistory(parsed);
      } else if (parsed && typeof parsed === "object") {
        // migrate single object → array
        setHistory([parsed]);
      } else {
        setHistory([]);
      }
    } catch {
      setHistory([]);
    }
  }, [house]);

  // =========================
  // Save meter
  // =========================
  async function save() {
    if (!room) return;

    setLoading(true);
    setError(null);

    try {
      const pin = sessionStorage.getItem("vtpt_pin") || "";

      const res = await fetch("/api/meter", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-vtpt-pin": pin,
        },
        body: JSON.stringify({
          room,
          dien: Number(dien),
          nuoc: Number(nuoc),
          note,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Save failed");
      }

      const entry: HistoryItem = {
        date: new Date().toISOString().slice(0, 10),
        dien: Number(dien),
        nuoc: Number(nuoc),
        note,
      };

      const nextHistory = [entry, ...history].slice(0, 50);
      setHistory(nextHistory);

      localStorage.setItem(houseHistoryKey(house), JSON.stringify(nextHistory));
      localStorage.setItem(houseLatestKey(house), JSON.stringify(entry));

      setNote("");
    } catch (err: any) {
      setError(err?.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (!room) return null;

  return (
    <main style={{ padding: 16 }}>
      <h1 style={{ marginBottom: 12 }}>Room {room}</h1>

      <div style={{ display: "grid", gap: 12, maxWidth: 420 }}>
        <label>
          Điện
          <input
            type="number"
            value={dien}
            onChange={(e) => setDien(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>

        <label>
          Nước
          <input
            type="number"
            value={nuoc}
            onChange={(e) => setNuoc(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>

        <label>
          Note
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>

        <button onClick={save} disabled={loading}>
          {loading ? "Saving…" : "Save"}
        </button>

        {error && <div style={{ color: "red", fontSize: 14 }}>{error}</div>}
      </div>

      <h2 style={{ marginTop: 24 }}>History</h2>

      {history.length === 0 ? (
        <div style={{ opacity: 0.6 }}>No history yet</div>
      ) : (
        <ul style={{ paddingLeft: 16 }}>
          {history.map((h, i) => (
            <li key={i}>
              {h.date} — Điện {h.dien}, Nước {h.nuoc}
              {h.note ? ` (${h.note})` : ""}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
