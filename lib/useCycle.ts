// lib/useCycle.ts
import { useEffect, useRef, useState } from "react";

const CYCLE_CACHE_KEY = "vtpt_cycle_key";
const CYCLE_CACHE_AT_KEY = "vtpt_cycle_key_at";
const TTL_MS = 5 * 60 * 1000; // 5 minutes

function isMonthKey(s: string) {
  return /^\d{4}-\d{2}$/.test((s || "").trim());
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

function readCache(): { key: string | null; fresh: boolean } {
  try {
    const key = localStorage.getItem(CYCLE_CACHE_KEY);
    const at = Number(localStorage.getItem(CYCLE_CACHE_AT_KEY) || 0);
    const fresh = key && isMonthKey(key) && Date.now() - at < TTL_MS;
    return { key: fresh ? key : null, fresh: !!fresh };
  } catch {
    return { key: null, fresh: false };
  }
}

function writeCache(key: string) {
  try {
    localStorage.setItem(CYCLE_CACHE_KEY, key);
    localStorage.setItem(CYCLE_CACHE_AT_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

/**
 * useCycle
 *
 * Guarantees:
 * - cycle is loaded ONCE per session (cached)
 * - no flicker on navigation
 * - background refresh is safe
 */
export function useCycle() {
  const [cycle, setCycle] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const inflight = useRef<Promise<void> | null>(null);

  async function refresh() {
    if (inflight.current) return inflight.current;

    inflight.current = (async () => {
      const backend = await fetchBackendCycleKeySafe();
      if (backend) {
        setCycle(backend);
        writeCache(backend);
      }
      setLoading(false);
      inflight.current = null;
    })();

    return inflight.current;
  }

  useEffect(() => {
    const cached = readCache();

    if (cached.key) {
      setCycle(cached.key);
      setLoading(false);

      // background refresh (silent)
      refresh();
    } else {
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    cycle,
    loading,
    refresh,
  };
}
