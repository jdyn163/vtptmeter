import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getRoomsByHouse, RoomsByHouse } from "../lib/rooms";

type CacheEnvelope<T> = { savedAt: number; data: T };

function cycleKey() {
  return `vtpt_cycle_month`;
}

function knownCyclesKey() {
  return `vtpt_known_cycles`;
}

function safeJsonParse<T>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function isMonthKey(s: string) {
  return /^\d{4}-\d{2}$/.test(String(s || "").trim());
}

function monthKeyNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function addMonth(month: string, delta: number) {
  // month = "YYYY-MM"
  if (!isMonthKey(month)) return monthKeyNow();
  const [yy, mm] = month.split("-").map((x) => Number(x));
  const base = new Date(yy, mm - 1 + delta, 1);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}`;
}

function timeText(ms?: number) {
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString();
}

function normalizeMonth(m: string) {
  const s = String(m || "")
    .trim()
    .replaceAll("_", "-");
  return isMonthKey(s) ? s : "";
}

function sortMonthKeys(list: string[]) {
  return [...list].sort((a, b) => {
    const [ay, am] = a.split("-").map(Number);
    const [by, bm] = b.split("-").map(Number);
    if (ay !== by) return ay - by;
    return am - bm;
  });
}

function uniq(list: string[]) {
  return Array.from(new Set(list));
}

// Accept a few response variants, but default to NOT admin (safe).
function parseIsAdmin(resp: any): boolean {
  if (!resp || typeof resp !== "object") return false;
  if (resp.isAdmin === true) return true;
  if (resp.admin === true) return true;
  if (String(resp.role || "").toLowerCase() === "admin") return true;
  if (String(resp.data?.role || "").toLowerCase() === "admin") return true;
  if (resp.data?.isAdmin === true) return true;
  if (resp.data?.admin === true) return true;
  return false;
}

export default function Home() {
  const [houses, setHouses] = useState<string[]>([]);

  // cycle state
  const [cycle, setCycle] = useState<string | null>(null);
  const [cycleStatus, setCycleStatus] = useState<string>("");

  // admin UI gating
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [adminStatus, setAdminStatus] = useState<string>("");

  // saving / toast
  const [savingCycle, setSavingCycle] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // known cycles (Option B + now includes Google Sheet)
  const [knownCycles, setKnownCycles] = useState<string[]>([]);

  // bottom sheet UI
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pendingCycle, setPendingCycle] = useState<string>("");
  const [customCycle, setCustomCycle] = useState<string>(""); // for manual prep

  const cycleDisplay = useMemo(() => {
    if (!cycle) return "…";
    return cycle;
  }, [cycle]);

  const currentCycleSafe = useMemo(() => {
    const c = String(cycle || "").trim();
    return isMonthKey(c) ? c : monthKeyNow();
  }, [cycle]);

  const cycleList = useMemo(() => {
    // Option B list = only what we've actually seen/used + pending (if valid)
    const base = knownCycles.filter(isMonthKey);
    const plusCurrent = isMonthKey(String(cycle || "")) ? [String(cycle)] : [];
    const plusPending = isMonthKey(pendingCycle) ? [pendingCycle] : [];
    const merged = uniq([...base, ...plusCurrent, ...plusPending]);
    return sortMonthKeys(merged);
  }, [knownCycles, cycle, pendingCycle]);

  useEffect(() => {
    const data: RoomsByHouse = getRoomsByHouse();
    const keys = Object.keys(data).sort();
    setHouses(keys);
  }, []);

  function showToast(msg: string, ms = 1600) {
    setToast(msg);
    window.setTimeout(() => {
      setToast((t) => (t === msg ? null : t));
    }, ms);
  }

  function readKnownCyclesFromStorage() {
    const raw = safeJsonParse<{ savedAt: number; data: string[] }>(
      localStorage.getItem(knownCyclesKey()),
    );
    const list = raw?.data || [];
    const cleaned = uniq(list.map(normalizeMonth).filter(Boolean));
    return sortMonthKeys(cleaned);
  }

  function writeKnownCyclesToStorage(list: string[]) {
    localStorage.setItem(
      knownCyclesKey(),
      JSON.stringify({ savedAt: Date.now(), data: sortMonthKeys(uniq(list)) }),
    );
  }

  function addKnownCycle(m: string) {
    const mm = normalizeMonth(m);
    if (!mm) return;
    setKnownCycles((prev) => {
      const next = sortMonthKeys(uniq([...prev, mm]));
      try {
        writeKnownCyclesToStorage(next);
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }

  function mergeKnownCycles(list: string[]) {
    const cleaned = list.map(normalizeMonth).filter(Boolean);
    if (!cleaned.length) return;
    setKnownCycles((prev) => {
      const next = sortMonthKeys(uniq([...prev, ...cleaned]));
      try {
        writeKnownCyclesToStorage(next);
      } catch {
        // ignore
      }
      return next;
    });
  }

  // Load known cycles (Option B memory)
  useEffect(() => {
    try {
      const list = readKnownCyclesFromStorage();
      setKnownCycles(list);
    } catch {
      setKnownCycles([]);
    }
  }, []);

  // ✅ NEW: Also learn cycles that exist in Google Sheet (2026-01, 2026-02, ...)
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/meter?action=cyclesGet`);
        const j = await r.json();
        const list: string[] = j && j.ok && Array.isArray(j.data) ? j.data : [];
        mergeKnownCycles(list);
      } catch {
        // ignore, we still have local memory + current cycle
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // load cycle cache first, then refresh from network
  useEffect(() => {
    const cached = safeJsonParse<CacheEnvelope<string>>(
      localStorage.getItem(cycleKey()),
    );

    if (cached?.data && isMonthKey(cached.data)) {
      setCycle(cached.data);
      setCycleStatus(`Cached ${timeText(cached.savedAt)}`);
      addKnownCycle(cached.data);
    } else {
      setCycle(null);
      setCycleStatus("No cache yet");
    }

    (async () => {
      try {
        const r = await fetch(`/api/meter?action=cycleGet`);
        const j = await r.json();
        const serverCycle = j && j.ok ? String(j.data || "").trim() : "";

        if (isMonthKey(serverCycle)) {
          setCycle(serverCycle);
          localStorage.setItem(
            cycleKey(),
            JSON.stringify({ savedAt: Date.now(), data: serverCycle }),
          );
          setCycleStatus(`Updated ${new Date().toLocaleTimeString()}`);
          addKnownCycle(serverCycle);
        } else {
          setCycleStatus("Cycle not available");
        }
      } catch {
        setCycleStatus("Cycle fetch failed (using cache)");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // detect if this PIN is admin
  useEffect(() => {
    const pin = (sessionStorage.getItem("vtpt_pin") || "").trim();
    if (!pin) {
      setIsAdmin(false);
      setAdminStatus("Locked");
      return;
    }

    (async () => {
      try {
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-vtpt-pin": pin,
          },
          body: JSON.stringify({ pin }),
        });

        const j = await res.json();
        const ok = !!j?.ok;

        if (!ok) {
          setIsAdmin(false);
          setAdminStatus("Not authorized");
          return;
        }

        const admin = parseIsAdmin(j);
        setIsAdmin(admin);
        setAdminStatus(admin ? "Admin" : "User");
      } catch {
        setIsAdmin(false);
        setAdminStatus("Auth check failed");
      }
    })();
  }, []);

  function openCycleSheet() {
    if (!isAdmin) return;
    const c = String(cycle || "").trim();
    const init = isMonthKey(c) ? c : monthKeyNow();
    setPendingCycle(init);
    setCustomCycle("");
    setSheetOpen(true);
  }

  function closeCycleSheet() {
    if (savingCycle) return; // don't close mid-save
    setSheetOpen(false);
  }

  function createNextCycle() {
    const next = addMonth(currentCycleSafe, 1);
    setPendingCycle(next);
    addKnownCycle(next);
    showToast(`Prepared ${next}`, 900);
  }

  function applyCustomCycle() {
    const m = normalizeMonth(customCycle);
    if (!m) {
      showToast("Use format YYYY-MM (ex: 2026-04)", 1600);
      return;
    }
    setPendingCycle(m);
    addKnownCycle(m);
    showToast(`Prepared ${m}`, 900);
  }

  async function saveCycle(month: string) {
    if (savingCycle) return;
    if (!isMonthKey(month)) return;

    const pin = (sessionStorage.getItem("vtpt_pin") || "").trim();
    if (!pin) {
      showToast("Missing PIN. Please go back and unlock again.", 1800);
      return;
    }

    if (!isAdmin) return;

    const current = isMonthKey(String(cycle || "")) ? String(cycle) : "…";
    const ok = window.confirm(
      `Set cycle?\n\n${current}  →  ${month}\n\nNew readings will be saved under ${month}.`,
    );
    if (!ok) return;

    setSavingCycle(true);

    // optimistic UI
    setCycle(month);
    addKnownCycle(month);
    localStorage.setItem(
      cycleKey(),
      JSON.stringify({ savedAt: Date.now(), data: month }),
    );
    setCycleStatus("Saving…");

    try {
      const res = await fetch("/api/meter", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-vtpt-pin": pin,
        },
        body: JSON.stringify({
          action: "cycleSet",
          month,
        }),
      });

      const j = await res.json();

      if (!j?.ok) {
        setCycleStatus("Save failed");
        showToast(j?.error || "Set cycle failed.", 2200);

        // best-effort sync back to server truth
        try {
          const rr = await fetch(`/api/meter?action=cycleGet`);
          const jj = await rr.json();
          const serverCycle = jj && jj.ok ? String(jj.data || "").trim() : "";
          if (isMonthKey(serverCycle)) {
            setCycle(serverCycle);
            addKnownCycle(serverCycle);
            localStorage.setItem(
              cycleKey(),
              JSON.stringify({ savedAt: Date.now(), data: serverCycle }),
            );
            setCycleStatus(`Synced ${new Date().toLocaleTimeString()}`);
          }
        } catch {
          // ignore
        }

        setSavingCycle(false);
        return;
      }

      setCycleStatus(`Set ✅ ${new Date().toLocaleTimeString()}`);
      showToast("Cycle updated ✅", 1400);
      setSavingCycle(false);
      setSheetOpen(false);
    } catch (e: any) {
      setCycleStatus("Save failed");
      showToast(String(e?.message || e), 2400);

      // best-effort sync back to server truth
      try {
        const rr = await fetch(`/api/meter?action=cycleGet`);
        const jj = await rr.json();
        const serverCycle = jj && jj.ok ? String(jj.data || "").trim() : "";
        if (isMonthKey(serverCycle)) {
          setCycle(serverCycle);
          addKnownCycle(serverCycle);
          localStorage.setItem(
            cycleKey(),
            JSON.stringify({ savedAt: Date.now(), data: serverCycle }),
          );
          setCycleStatus(`Synced ${new Date().toLocaleTimeString()}`);
        }
      } catch {
        // ignore
      }

      setSavingCycle(false);
    }
  }

  return (
    <main
      style={{
        padding: 16,
        maxWidth: 480,
        margin: "0 auto",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ marginBottom: 6 }}>VTPT Meter</h1>

          {/* Calm cycle strip */}
          <div
            style={{
              fontSize: 12,
              opacity: 0.72,
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div>
              Cycle: <span style={{ fontWeight: 900 }}>{cycleDisplay}</span>{" "}
              <span style={{ opacity: 0.8 }}>• {cycleStatus}</span>
            </div>

            {adminStatus && (
              <span style={{ opacity: 0.55 }}>• {adminStatus}</span>
            )}

            {isAdmin && (
              <button
                onClick={openCycleSheet}
                disabled={savingCycle}
                style={{
                  marginLeft: 4,
                  padding: "4px 10px",
                  borderRadius: 999,
                  border: "1px solid #111",
                  background: "#fff",
                  color: "#111",
                  fontWeight: 900,
                  fontSize: 12,
                  cursor: savingCycle ? "not-allowed" : "pointer",
                  opacity: savingCycle ? 0.6 : 1,
                }}
              >
                Change
              </button>
            )}
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
              whiteSpace: "nowrap",
            }}
          >
            {toast}
          </div>
        )}
      </div>

      {/* Houses */}
      <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
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

      {/* Bottom sheet overlay (admin only) */}
      {sheetOpen && isAdmin && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) closeCycleSheet();
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.25)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            padding: 12,
            zIndex: 50,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 520,
              background: "#fff",
              borderRadius: 16,
              border: "1px solid #ddd",
              boxShadow: "0 12px 40px rgba(0,0,0,0.18)",
              overflow: "hidden",
            }}
          >
            {/* Sheet header */}
            <div
              style={{
                padding: 12,
                borderBottom: "1px solid #eee",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div style={{ fontWeight: 900, flex: 1 }}>Set Cycle</div>
              <button
                onClick={closeCycleSheet}
                disabled={savingCycle}
                style={{
                  padding: "6px 10px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  background: "#fff",
                  fontWeight: 900,
                  cursor: savingCycle ? "not-allowed" : "pointer",
                  opacity: savingCycle ? 0.6 : 1,
                }}
              >
                Close
              </button>
            </div>

            {/* Sheet body */}
            <div style={{ padding: 12 }}>
              <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 10 }}>
                Cycles are pulled from your Google Sheet + local memory. No auto
                time-travel.
              </div>

              {/* Quick actions */}
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                  marginBottom: 10,
                }}
              >
                <button
                  onClick={createNextCycle}
                  disabled={savingCycle}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 12,
                    border: "1px solid #111",
                    background: "#111",
                    color: "#fff",
                    fontWeight: 900,
                    cursor: savingCycle ? "not-allowed" : "pointer",
                    opacity: savingCycle ? 0.6 : 1,
                  }}
                >
                  Create next month
                </button>

                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    value={customCycle}
                    onChange={(e) => setCustomCycle(e.target.value)}
                    placeholder="YYYY-MM"
                    inputMode="numeric"
                    disabled={savingCycle}
                    style={{
                      width: 110,
                      padding: "8px 10px",
                      borderRadius: 12,
                      border: "1px solid #ddd",
                      fontWeight: 900,
                      fontSize: 12,
                      opacity: savingCycle ? 0.6 : 1,
                    }}
                  />
                  <button
                    onClick={applyCustomCycle}
                    disabled={savingCycle}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 12,
                      border: "1px solid #ddd",
                      background: "#fff",
                      fontWeight: 900,
                      cursor: savingCycle ? "not-allowed" : "pointer",
                      opacity: savingCycle ? 0.6 : 1,
                    }}
                  >
                    Prep
                  </button>
                </div>
              </div>

              {/* Cycle list */}
              <div
                style={{
                  border: "1px solid #eee",
                  borderRadius: 12,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    maxHeight: 220,
                    overflowY: "auto",
                    padding: 8,
                    display: "grid",
                    gap: 8,
                    background: "#fafafa",
                  }}
                >
                  {cycleList.length === 0 && (
                    <div style={{ padding: 12, fontSize: 12, opacity: 0.7 }}>
                      No known cycles yet. Set one first.
                    </div>
                  )}

                  {cycleList.map((m) => {
                    const checked = pendingCycle === m;
                    const isActive = String(cycle || "") === m;
                    return (
                      <label
                        key={m}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "10px 12px",
                          borderRadius: 12,
                          border: checked ? "1px solid #111" : "1px solid #ddd",
                          background: "#fff",
                          cursor: savingCycle ? "not-allowed" : "pointer",
                          opacity: savingCycle ? 0.7 : 1,
                          userSelect: "none",
                        }}
                      >
                        <input
                          type="radio"
                          name="vtpt_cycle_pick"
                          value={m}
                          checked={checked}
                          disabled={savingCycle}
                          onChange={() => setPendingCycle(m)}
                          style={{ transform: "scale(1.1)" }}
                        />
                        <div style={{ fontWeight: 900, letterSpacing: 0.2 }}>
                          {m}
                        </div>
                        <div
                          style={{
                            marginLeft: "auto",
                            fontSize: 12,
                            opacity: 0.7,
                          }}
                        >
                          {isActive ? "ACTIVE" : ""}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Confirm strip */}
              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                }}
              >
                <div style={{ flex: 1, fontSize: 12, opacity: 0.75 }}>
                  Selected:{" "}
                  <span style={{ fontWeight: 900 }}>{pendingCycle || "…"}</span>
                </div>

                <button
                  onClick={() => saveCycle(pendingCycle)}
                  disabled={savingCycle || !isMonthKey(pendingCycle)}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid #111",
                    background:
                      savingCycle || !isMonthKey(pendingCycle)
                        ? "#ddd"
                        : "#111",
                    color:
                      savingCycle || !isMonthKey(pendingCycle)
                        ? "#333"
                        : "#fff",
                    fontWeight: 900,
                    cursor:
                      savingCycle || !isMonthKey(pendingCycle)
                        ? "not-allowed"
                        : "pointer",
                    minWidth: 110,
                  }}
                >
                  {savingCycle ? "Saving…" : "Confirm"}
                </button>
              </div>

              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.6 }}>
                Tip: Prep adds it to the list. Confirm is what actually sets it.
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
