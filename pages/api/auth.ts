// pages/api/auth.ts
import type { NextApiRequest, NextApiResponse } from "next";

// Format: "1111:Masie,2222:Brother,3333:Thuan"
const VTPT_PINS = process.env.VTPT_PINS;

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

function isAdminActor(actor: string) {
  // Keep this strict + predictable.
  // If you later want multiple admins, we can switch to env VTPT_ADMINS.
  return (
    String(actor || "")
      .trim()
      .toLowerCase() === "masie"
  );
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

    const pin = String(req.body?.pin || "").trim();
    const actor = pins[pin];

    if (!actor) {
      return res.status(401).json({ ok: false, error: "Wrong PIN" });
    }

    const admin = isAdminActor(actor);
    const role: Role = admin ? "admin" : "user";

    return res.status(200).json({ ok: true, actor, role, isAdmin: admin });
  } catch (err: any) {
    return res
      .status(500)
      .json({ ok: false, error: err?.message || String(err) });
  }
}
