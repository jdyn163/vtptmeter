// lib/vnTime.ts
// Single source of truth for Vietnam-time (Asia/Ho_Chi_Minh) date keys + formatting.

export const VN_TZ = "Asia/Ho_Chi_Minh";

// Internal helper: format a Date in VN timezone and return parts
function vnParts(d: Date): { y: string; m: string; day: string } | null {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;

  // Use formatToParts so we don't depend on locale ordering
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: VN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = fmt.formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;

  if (!y || !m || !day) return null;
  return { y, m, day };
}

/** VN calendar date key: "YYYY-MM-DD" from an ISO string (or any Date-parseable string). */
export function vnDateKeyFromISO(isoLike: string): string {
  const d = new Date(isoLike);
  const p = vnParts(d);
  if (!p) return "";
  return `${p.y}-${p.m}-${p.day}`;
}

/** VN calendar date key: "YYYY-MM-DD" from a Date object. */
export function vnDateKeyFromDate(d: Date): string {
  const p = vnParts(d);
  if (!p) return "";
  return `${p.y}-${p.m}-${p.day}`;
}

/** VN "today" date key: "YYYY-MM-DD" */
export function vnTodayKey(): string {
  return vnDateKeyFromDate(new Date());
}

/** VN month key: "YYYY-MM" from an ISO string (or any Date-parseable string). */
export function vnMonthKeyFromISO(isoLike: string): string {
  const d = new Date(isoLike);
  const p = vnParts(d);
  if (!p) return "";
  return `${p.y}-${p.m}`;
}

/** VN month key: "YYYY-MM" for "now" */
export function vnNowMonthKey(): string {
  return vnMonthKeyFromISO(new Date().toISOString());
}

/** Compare two ISO-like timestamps by VN calendar day */
export function isSameVnDay(aIsoLike: string, bIsoLike: string): boolean {
  const a = vnDateKeyFromISO(aIsoLike);
  const b = vnDateKeyFromISO(bIsoLike);
  return !!a && a === b;
}

/** Optional: format VN date time nicely for UI (stable, readable). */
export function formatVnDateTime(isoLike: string): string {
  const d = new Date(isoLike);
  if (Number.isNaN(d.getTime())) return String(isoLike || "");

  // Example output: "2026-02-10 17:31"
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: VN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  // en-CA commonly yields "YYYY-MM-DD, HH:MM"
  return fmt.format(d).replace(", ", " ");
}
