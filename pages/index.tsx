// pages/index.tsx
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getRoomsByHouse, RoomsByHouse } from "../lib/rooms";
import BottomSheet from "../components/BottomSheet";

const TZ = "Asia/Ho_Chi_Minh";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function monthKeyFromParts(y: number, m: number) {
  return `${y}-${pad2(m)}`;
}

function isMonthKey(s: string) {
  return /^\d{4}-\d{2}$/.test((s || "").trim());
}

// timezone-stable month key for Vietnam (offline fallback only)
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

// numeric-only helpers
function digitsOnly(s: string) {
  return String(s ?? "").replace(/[^\d]/g, "");
}

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

export default function Home() {
  const [houses, setHouses] = useState<string[]>([]);
  const [approving, setApproving] = useState(false);
  const [approveMsg, setApproveMsg] = useState<string | null>(null);

  // bottom sheet state
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [cycle, setCycle] = useState<string>(""); // UI-only label
  const [mounted, setMounted] = useState(false);

  const canOpen = useMemo(() => !approving, [approving]);

  async function syncCycle() {
    const backend = await fetchBackendCycleKeySafe();
    if (backend) {
      setCycle(backend);
      return;
    }
    // offline fallback only (do NOT persist locally)
    setCycle(monthKeyVN(new Date()));
  }

  useEffect(() => {
    setMounted(true);

    const data: RoomsByHouse = getRoomsByHouse();
    const keys = Object.keys(data).sort();
    setHouses(keys);

    void syncCycle();
  }, []);

  // whenever sheet opens, refresh cycle + clear inputs
  useEffect(() => {
    if (!open) return;
    void syncCycle();
    setPin("");
    setApproveMsg(null);
  }, [open]);

  async function approveNextMonth() {
    const trimmedPin = pin.trim();
    if (!trimmedPin) {
      window.alert("Enter admin PIN.");
      return;
    }

    // Use current UI cycle if valid; otherwise fetch backend; otherwise fallback VN month
    const currentCycleKey =
      cycle && isMonthKey(cycle)
        ? cycle
        : (await fetchBackendCycleKeySafe()) || monthKeyVN(new Date());

    setApproving(true);
    setApproveMsg(null);

    try {
      const res = await fetch("/api/meter?action=approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pin: trimmedPin,
          mode: "approve",
          currentCycleKey,
        }),
      });

      const text = await res.text();
      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = { ok: res.ok, message: text };
      }

      if (!res.ok || !data?.ok) {
        const msg =
          data?.error ||
          data?.message ||
          "Access denied or approve failed. Please try again.";
        setApproveMsg(msg);
        window.alert(msg);
        return;
      }

      // After approve, ALWAYS re-read backend (single source of truth)
      await syncCycle();

      const msg = data?.message || "Approved ✅";
      setApproveMsg(msg);
      window.alert(msg);
    } catch (e: any) {
      const msg = e?.message || "Network error. Please try again.";
      setApproveMsg(msg);
      window.alert(msg);
    } finally {
      setApproving(false);
      setOpen(false);
    }
  }

  // Keep SSR stable
  const cycleLabel = mounted ? cycle || "…" : "…";

  return (
    <main
      style={{
        padding: 16,
        maxWidth: 480,
        margin: "0 auto",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div style={{ display: "grid", gap: 2 }}>
          <h1 style={{ margin: 0 }}>VTPT Meter</h1>
          <div style={{ fontSize: 12, opacity: 0.55 }}>Cycle: {cycleLabel}</div>
        </div>

        <button
          onClick={() => canOpen && setOpen(true)}
          disabled={!canOpen}
          style={{
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid #ddd",
            background: approving ? "#f3f3f3" : "#fff",
            cursor: approving ? "not-allowed" : "pointer",
            fontWeight: 700,
            lineHeight: 1,
            whiteSpace: "nowrap",
          }}
          aria-label="Approve month (admin)"
          title="Approve month (admin)"
        >
          {approving ? "Working…" : "Approve"}
        </button>
      </div>

      {approveMsg ? (
        <div
          style={{
            marginBottom: 12,
            padding: 10,
            borderRadius: 12,
            border: "1px solid #eee",
            background: "#fafafa",
            fontSize: 13,
          }}
        >
          {approveMsg}
        </div>
      ) : null}

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

      <BottomSheet
        open={open}
        title="Approve month"
        onClose={() => {
          if (approving) return;
          setOpen(false);
        }}
        disabled={approving}
      >
        <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
          <div
            style={{
              background: "#fff",
              border: "1px solid #e5e5e5",
              borderRadius: 14,
              padding: 12,
            }}
          >
            <div style={{ fontWeight: 900, opacity: 0.7 }}>Current cycle</div>
            <div style={{ fontSize: 22, fontWeight: 950, marginTop: 6 }}>
              {cycleLabel}
            </div>
            <div style={{ fontSize: 12, opacity: 0.5, marginTop: 4 }}>
              Approve will move to the next month.
            </div>
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 900, marginLeft: 2 }}>Admin PIN</div>
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
                value={pin}
                onChange={(e) => setPin(digitsOnly(e.target.value))}
                placeholder="PIN"
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

          <button
            onClick={approveNextMonth}
            disabled={approving}
            style={{
              padding: 12,
              borderRadius: 12,
              border: "1px solid #111",
              background: approving ? "#ddd" : "#111",
              color: approving ? "#333" : "#fff",
              fontWeight: 900,
              cursor: approving ? "not-allowed" : "pointer",
            }}
          >
            {approving ? "Approving…" : "Approve next month"}
          </button>

          <button
            onClick={() => setOpen(false)}
            disabled={approving}
            style={{
              padding: 12,
              borderRadius: 12,
              border: "1px solid #eee",
              background: "#fafafa",
              fontWeight: 900,
              cursor: approving ? "not-allowed" : "pointer",
            }}
          >
            Cancel
          </button>

          <div style={{ height: 6 }} />
        </div>
      </BottomSheet>
    </main>
  );
}
