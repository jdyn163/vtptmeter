// pages/unlock.tsx
import { useRouter } from "next/router";
import { useEffect, useMemo, useRef, useState } from "react";

const PIN_STORAGE_KEY = "vtpt_pin";
const PIN_LENGTH = 4;

function onlyDigits(s: string) {
  return (s || "").replace(/\D/g, "");
}

export default function UnlockPage() {
  const router = useRouter();
  const [digits, setDigits] = useState<string[]>(Array(PIN_LENGTH).fill(""));
  const [error, setError] = useState<string | null>(null);
  const [redirectTo, setRedirectTo] = useState<string>("/");

  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);
  const pin = useMemo(() => digits.join(""), [digits]);

  useEffect(() => {
    const next =
      typeof router.query.next === "string" ? router.query.next : "/";
    setRedirectTo(next);

    const existing = (sessionStorage.getItem(PIN_STORAGE_KEY) || "").trim();
    if (existing) router.replace(next);

    setTimeout(() => inputsRef.current[0]?.focus(), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  function focusIndex(i: number) {
    const idx = Math.max(0, Math.min(PIN_LENGTH - 1, i));
    inputsRef.current[idx]?.focus();
    inputsRef.current[idx]?.select?.();
  }

  function updateDigitAt(index: number, value: string) {
    const d = onlyDigits(value);
    const next = [...digits];

    // Paste / multi-digit handling
    if (d.length > 1) {
      let i = index;
      for (const ch of d) {
        if (i >= PIN_LENGTH) break;
        next[i++] = ch;
      }
      setDigits(next);
      setError(null);
      focusIndex(Math.min(PIN_LENGTH - 1, index + d.length));
      return;
    }

    next[index] = d.slice(0, 1);
    setDigits(next);
    setError(null);
    if (d && index < PIN_LENGTH - 1) focusIndex(index + 1);
  }

  function onKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      const next = [...digits];
      if (next[index]) {
        next[index] = "";
        setDigits(next);
      } else if (index > 0) {
        next[index - 1] = "";
        setDigits(next);
        focusIndex(index - 1);
      }
      setError(null);
      e.preventDefault();
      return;
    }

    if (e.key === "ArrowLeft") {
      if (index > 0) focusIndex(index - 1);
      e.preventDefault();
      return;
    }

    if (e.key === "ArrowRight") {
      if (index < PIN_LENGTH - 1) focusIndex(index + 1);
      e.preventDefault();
      return;
    }

    if (e.key === "Enter") {
      unlock();
      e.preventDefault();
    }
  }

  function onPaste(index: number, e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    const d = onlyDigits(text);
    if (!d) return;
    e.preventDefault();
    updateDigitAt(index, d);
  }

  function unlock() {
    if (digits.some((d) => !d)) {
      setError(`PIN must be ${PIN_LENGTH} digits`);
      focusIndex(digits.findIndex((x) => !x));
      return;
    }
    sessionStorage.setItem(PIN_STORAGE_KEY, pin);
    router.replace(redirectTo);
  }

  function clearPin() {
    setDigits(Array(PIN_LENGTH).fill(""));
    setError(null);
    focusIndex(0);
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 16,
        fontFamily:
          "'Poppins', system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        boxSizing: "border-box",
        background:
          "radial-gradient(900px 500px at 10% 0%, rgba(0,0,0,0.05), transparent)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          borderRadius: 22,
          padding: 24,
          background: "#fff",
          boxShadow: "0 20px 60px rgba(0,0,0,0.12)",
          overflow: "hidden", // ✅ nothing can spill outside visually
          boxSizing: "border-box",
        }}
      >
        <div
          style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>
              VTPT Meter
            </h1>
            <div style={{ opacity: 0.65, marginTop: 8 }}>
              Enter your {PIN_LENGTH}-digit PIN
            </div>
          </div>

          <button
            onClick={clearPin}
            style={{
              padding: "8px 12px",
              borderRadius: 12,
              border: "1px solid rgba(0,0,0,0.14)",
              background: "transparent",
              cursor: "pointer",
              height: 40,
              alignSelf: "start",
              boxSizing: "border-box",
            }}
          >
            Clear
          </button>
        </div>

        <div style={{ height: 22 }} />

        {/* PIN row wrapper ensures safe width */}
        <div style={{ display: "flex", justifyContent: "center" }}>
          <div
            style={{
              width: "100%",
              maxWidth: 320, // ✅ hard limit
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${PIN_LENGTH}, minmax(0, 1fr))`, // ✅ prevents overflow
                gap: 12,
                width: "100%",
                boxSizing: "border-box",
              }}
            >
              {digits.map((val, i) => (
                <input
                  key={i}
                  ref={(el) => (inputsRef.current[i] = el)}
                  value={val}
                  onChange={(e) => updateDigitAt(i, e.target.value)}
                  onKeyDown={(e) => onKeyDown(i, e)}
                  onPaste={(e) => onPaste(i, e)}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  aria-label={`PIN digit ${i + 1}`}
                  style={{
                    width: "100%", // ✅ important
                    height: 64,
                    borderRadius: 16,
                    border: error
                      ? "2px solid #ef4444"
                      : "1px solid rgba(0,0,0,0.16)",
                    textAlign: "center",
                    fontSize: 26,
                    fontWeight: 700,
                    outline: "none",
                    boxSizing: "border-box", // ✅ important
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        {error ? (
          <div style={{ marginTop: 14, color: "#ef4444", fontSize: 13 }}>
            {error}
          </div>
        ) : (
          <div style={{ marginTop: 14, fontSize: 13, opacity: 0.6 }}>
            Tip: you can paste all digits at once.
          </div>
        )}

        <button
          onClick={unlock}
          style={{
            marginTop: 22,
            width: "100%",
            padding: "14px 16px",
            borderRadius: 16,
            border: "none",
            background: "#111827",
            color: "white",
            fontSize: 16,
            fontWeight: 700,
            cursor: "pointer",
            boxSizing: "border-box",
          }}
        >
          Unlock
        </button>

        <div style={{ marginTop: 12, fontSize: 12, opacity: 0.6 }}>
          Session only · closes when tab closes
        </div>
      </div>
    </main>
  );
}
