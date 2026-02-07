import { useEffect, useState } from "react";
import type React from "react";

type BottomSheetProps = {
  open: boolean;
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
  disabled?: boolean;
};

export default function BottomSheet({
  open,
  title,
  onClose,
  children,
  disabled = false,
}: BottomSheetProps) {
  const [mounted, setMounted] = useState(open);
  const [phase, setPhase] = useState<"enter" | "open" | "exit">("open");

  useEffect(() => {
    if (open) {
      setMounted(true);
      setPhase("enter");
      const raf = requestAnimationFrame(() => setPhase("open"));
      return () => cancelAnimationFrame(raf);
    }

    if (mounted) {
      setPhase("exit");
      const t = window.setTimeout(() => setMounted(false), 220);
      return () => window.clearTimeout(t);
    }
  }, [open, mounted]);

  useEffect(() => {
    if (!mounted) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !disabled) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mounted, disabled, onClose]);

  if (!mounted) return null;

  const isEnter = phase === "enter";
  const isExit = phase === "exit";

  const close = () => {
    if (disabled) return;
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={close}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.35)",
          zIndex: 100,
          opacity: isEnter ? 0 : isExit ? 0 : 1,
          transition: "opacity 220ms ease",
        }}
      />

      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 110,
          background: "#fff",
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          boxShadow: "0 -12px 30px rgba(0,0,0,0.18)",

          maxHeight: "85vh",
          overflow: "hidden",

          transform: isEnter || isExit ? "translateY(24px)" : "translateY(0)",
          opacity: isEnter || isExit ? 0 : 1,
          transition:
            "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 220ms ease",
          willChange: "transform, opacity",
        }}
      >
        {/* Scroll container */}
        <div
          style={{
            maxHeight: "85vh",
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
          }}
        >
          {/* Inner wrapper */}
          <div
            style={{
              width: "100%",
              padding: 16,
              paddingBottom: "calc(16px + env(safe-area-inset-bottom))",
              boxSizing: "border-box",
            }}
          >
            {/* Drag handle */}
            <div
              style={{
                width: 44,
                height: 5,
                borderRadius: 999,
                background: "#e5e5e5",
                margin: "2px auto 12px",
              }}
            />

            {/* Header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 12,
              }}
            >
              <div style={{ fontWeight: 900, fontSize: 16, flex: 1 }}>
                {title}
              </div>

              <button
                onClick={close}
                disabled={disabled}
                aria-label="Close"
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 999,
                  border: "1px solid #ddd",
                  background: "#fff",
                  cursor: disabled ? "not-allowed" : "pointer",
                  fontWeight: 900,
                  opacity: disabled ? 0.6 : 1,
                }}
              >
                ×
              </button>
            </div>

            {children}
          </div>
        </div>
      </div>
    </>
  );
}
