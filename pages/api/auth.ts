// pages/api/auth.ts
import type { NextApiRequest, NextApiResponse } from "next";

// VTPT_PINS format: "1111:Masie,2222:Brother,3333:Thuan"
const VTPT_PINS = process.env.VTPT_PINS;

// VTPT_ADMIN_PINS supports ANY of these formats:
// - "1111,2222"
// - "1111:Masie,2222:Brother"   (label after ":" is ignored)
// - "1111;2222" or "1111 2222"  (we normalize separators)
const VTPT_ADMIN_PINS = process.env.VTPT_ADMIN_PINS;

type Role = "admin" | "user";

type Ok = { ok: true; actor: string; role: Role; isAdmin: boolean };
type Err = { ok: false; error: string };

function parsePins(pinsRaw: string): Record<string, string> {
  const map: Record<string, string> = {};
  const items = pinsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const item of items) {
    const idx = item.indexOf(":");
    if (idx === -1) continue;

    const pin = item.slice(0, idx).trim();
    const name = item.slice(idx + 1).trim();
    if (!pin || !name) continue;

    map[pin] = name;
  }

  return map;
}

function parseAdminPins(raw: string | undefined): Set<string> {
  if (!raw) return new Set();

  // Normalize separators to comma, then parse each token.
  const normalized = raw
    .replaceAll("\n", ",")
    .replaceAll("\r", ",")
    .replaceAll(";", ",")
    .replaceAll("|", ",")
    .replaceAll(" ", ",");

  const set = new Set<string>();

  for (const part of normalized
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    // allow "1234:Masie" too (ignore label)
    const pin = part.includes(":") ? part.split(":")[0].trim() : part;
    if (pin) set.add(pin);
  }

  return set;
}

function getHeaderPin(req: NextApiRequest): string {
  const raw = req.headers["x-vtpt-pin"];
  const pin = Array.isArray(raw) ? raw[0] : raw;
  return (pin || "").trim();
}

function getPinFromRequest(req: NextApiRequest): string {
  // Prefer header (used by some callers), fallback to body (unlock page)
  const headerPin = getHeaderPin(req);
  if (headerPin) return headerPin;
  return String(req.body?.pin || "").trim();
}

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<Ok | Err>,
) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    if (!VTPT_PINS) {
      return res.status(500).json({
        ok: false,
        error: "Server not configured: VTPT_PINS is missing.",
      });
    }

    const pins = parsePins(VTPT_PINS);
    if (!Object.keys(pins).length) {
      return res.status(500).json({
        ok: false,
        error:
          "Server not configured: VTPT_PINS is empty/invalid (expected '1111:Masie,2222:Brother').",
      });
    }

    const pin = getPinFromRequest(req);
    if (!pin) {
      return res.status(401).json({ ok: false, error: "Wrong PIN" });
    }

    const actor = pins[pin];
    if (!actor) {
      return res.status(401).json({ ok: false, error: "Wrong PIN" });
    }

    const adminPins = parseAdminPins(VTPT_ADMIN_PINS);
    const isAdmin = adminPins.has(pin);
    const role: Role = isAdmin ? "admin" : "user";

    return res.status(200).json({ ok: true, actor, role, isAdmin });
  } catch (err: any) {
    return res
      .status(500)
      .json({ ok: false, error: err?.message || String(err) });
  }
}
