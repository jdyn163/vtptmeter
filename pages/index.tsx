import Link from "next/link";
import { useEffect, useState } from "react";
import { getRoomsByHouse, RoomsByHouse } from "../lib/rooms";

export default function Home() {
  const [houses, setHouses] = useState<string[]>([]);

  useEffect(() => {
    const data: RoomsByHouse = getRoomsByHouse();
    const keys = Object.keys(data).sort();
    setHouses(keys);
  }, []);

  return (
    <main
      style={{
        padding: 16,
        maxWidth: 480,
        margin: "0 auto",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 style={{ marginBottom: 12 }}>VTPT Meter</h1>

      <div style={{ display: "grid", gap: 10 }}>
        {houses.map((house) => (
          <Link
            key={house}
            href={`/house/${encodeURIComponent(house)}`}
            style={{
              padding: 14,
              border: "1px solid #ddd",
              borderRadius: 12,
              textDecoration: "none",
              color: "inherit",
              background: "#fff",
            }}
          >
            <div style={{ fontWeight: 600 }}>{house}</div>
          </Link>
        ))}
      </div>
    </main>
  );
}
