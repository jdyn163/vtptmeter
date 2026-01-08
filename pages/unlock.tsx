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
    if (!router.isReady) return;

    const next =
      typeof router.query.next === "string" ? router.query.next : "/";
    setRedirectTo(next);

    // If already unlocked in this tab, go straight through
    const existing = (sessionStorage.getItem(PIN_STORAGE_KEY) || "").trim();
    if (existing) {
      router.replace(next);
      return;
    }

    // Focus first box
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

    // Handle paste / multi-digit input
    if (d.length > 1) {
      const nextDigits = [...digits];
      let writeAt = index;

      for (const ch of d) {
        if (writeAt >= PIN_LENGTH) break;
        nextDigits[writeAt] = ch;
        writeAt++;
      }

      setDigits(nextDigits);
      setError(null);

      if (writeAt >= PIN_LENGTH) focusIndex(PIN_LENGTH - 1);
      else focusIndex(writeAt);

      return;
    }

    const nextDigits = [...digits];
    nextDigits[index] = d.slice(0, 1);
    setDigits(nextDigits);
    setError(null);

    if (d && index < PIN_LENGTH - 1) focusIndex(index + 1);
  }

  function onKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      const nextDigits = [...digits];

      if (nextDigits[index]) {
        nextDigits[index] = "";
        setDigits(nextDigits);
        setError(null);
        e.preventDefault();
        return;
      }

      if (index > 0) {
        nextDigits[index - 1] = "";
        setDigits(nextDigits);
        setError(null);
        focusIndex(index - 1);
        e.preventDefault();
        return;
      }
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
      setError(`PIN must be exactly ${PIN_LENGTH} digits.`);
      const firstEmpty = digits.findIndex((x) => !x);
      focusIndex(firstEmpty === -1 ? PIN_LENGTH - 1 : firstEmpty);
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
          overflow: "hidden",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
          }}
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
              boxSizing: "border-box",
              fontWeight: 600,
            }}
          >
            Clear
          </button>
        </div>

        <div style={{ height: 22 }} />

        <div style={{ display: "flex", justifyContent: "center" }}>
          <div
            style={{ width: "100%", maxWidth: 320, boxSizing: "border-box" }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${PIN_LENGTH}, minmax(0, 1fr))`,
                gap: 12,
                width: "100%",
                boxSizing: "border-box",
              }}
            >
              {digits.map((val, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    // ✅ IMPORTANT: do not return anything from ref callback
                    inputsRef.current[i] = el;
                  }}
                  value={val}
                  onChange={(e) => updateDigitAt(i, e.target.value)}
                  onKeyDown={(e) => onKeyDown(i, e)}
                  onPaste={(e) => onPaste(i, e)}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  aria-label={`PIN digit ${i + 1}`}
                  style={{
                    width: "100%",
                    height: 64,
                    borderRadius: 16,
                    border: error
                      ? "2px solid #ef4444"
                      : "1px solid rgba(0,0,0,0.16)",
                    textAlign: "center",
                    fontSize: 26,
                    fontWeight: 700,
                    outline: "none",
                    boxSizing: "border-box",
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
            fontWeight: 800,
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
