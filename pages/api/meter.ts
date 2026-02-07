// pages/api/meter.ts
import type { NextApiRequest, NextApiResponse } from "next";

const SCRIPT_URL = process.env.SCRIPT_URL;
const SCRIPT_TOKEN = process.env.SCRIPT_TOKEN;

// User pins format (same as /api/auth): "1111:Masie,2222:Brother,3333:Thuan"
const VTPT_PINS_RAW = process.env.VTPT_PINS || "";

// Admin pins format: "0511,2222,3333" (numbers only)
const VTPT_ADMIN_PINS = (process.env.VTPT_ADMIN_PINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Flexible ok type so we can return {data} OR {nextMonthKey,...} without TS drama
type ApiOk<T = any> = {
  ok: true;
  data?: T;
  message?: string;
  [k: string]: any;
};
type ApiErr = { ok: false; error: string };

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

// Build once per invocation (serverless) to avoid reparsing repeatedly
function getPinsMap(): Record<string, string> {
  return parsePins(VTPT_PINS_RAW);
}

function getPin(req: NextApiRequest): string {
  const headerPin = req.headers["x-vtpt-pin"];
  if (typeof headerPin === "string") return headerPin.trim();
  if (req.body && typeof req.body.pin === "string") return req.body.pin.trim();
  return "";
}

function getAction(req: NextApiRequest): string {
  // Support both:
  // - /api/meter?action=approve (query)
  // - POST body: { action: "save" } (room page)
  const q = String(req.query.action || "").trim();
  const b =
    req.body && typeof req.body.action === "string"
      ? req.body.action.trim()
      : "";
  return q || b;
}

function isAdminPin(pin: string) {
  return !!pin && VTPT_ADMIN_PINS.includes(pin);
}

function isUserPin(pin: string) {
  if (!pin) return false;
  // admin pin is also allowed to do normal user actions
  if (isAdminPin(pin)) return true;

  const map = getPinsMap();
  return !!map[pin];
}

function actorForPin(pin: string): string | undefined {
  if (!pin) return undefined;

  // If admin pin is also listed in VTPT_PINS, we can show the name.
  // If not, still allow admin actions but the actor name may be undefined.
  const map = getPinsMap();
  return map[pin];
}

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    throw new Error(text || `Upstream error ${res.status}`);
  }
}

function buildScriptUrl(params: Record<string, string>) {
  if (!SCRIPT_URL) throw new Error("Missing SCRIPT_URL");
  if (!SCRIPT_TOKEN) throw new Error("Missing SCRIPT_TOKEN");

  const url = new URL(SCRIPT_URL);
  url.searchParams.set("token", SCRIPT_TOKEN);

  Object.entries(params).forEach(([k, v]) => {
    if (v) url.searchParams.set(k, v);
  });

  return url.toString();
}

function isMonthKey(s: string) {
  return /^\d{4}-\d{2}$/.test(String(s || "").trim());
}

function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function nextMonth(key: string) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() + 1);
  return monthKey(d);
}

async function scriptCycleSet(month: string, actor?: string) {
  const url = buildScriptUrl({});
  const payload: Record<string, any> = { action: "cycleSet", month };

  // Optional: include actor for audit trail if Apps Script supports it
  if (actor) {
    payload.actor = actor;
    payload.by = actor;
  }

  return fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function normalizeForwardedBody(body: Record<string, any>) {
  // 1) Normalize update -> save (Apps Script often only supports "save")
  if (typeof body.action === "string" && body.action.trim() === "update") {
    body.action = "save";
  }

  // 2) If target is present, we are editing an existing row.
  //    In that case, NEVER send cycleMonthKey, because some upstream scripts
  //    treat it as "create a cycle row" and will append a new row.
  const target = body.target;
  const hasTarget =
    target &&
    typeof target === "object" &&
    typeof target.id === "number" &&
    Number.isFinite(target.id) &&
    typeof target.date === "string" &&
    target.date.trim().length > 0;

  if (hasTarget) {
    if ("cycleMonthKey" in body) delete body.cycleMonthKey;

    // Safety: if date is missing, fall back to target.date so we don't create a new row
    if (typeof body.date !== "string" || !body.date.trim()) {
      body.date = target.date;
    }
  }

  return body;
}

function wantsDebug(req: NextApiRequest, pin: string) {
  // Only allow debug output if:
  // - admin pin, AND
  // - explicitly requested
  const q = String(req.query.debug || "").trim();
  const h = String(req.headers["x-vtpt-debug"] || "").trim();
  const b =
    req.body && typeof req.body.debug === "boolean" ? req.body.debug : false;

  return isAdminPin(pin) && (q === "1" || h === "1" || b === true);
}

function sanitizeForDebug(input: any) {
  // Make a shallow safe copy; never include secrets
  const obj: Record<string, any> =
    input && typeof input === "object" ? { ...input } : { value: input };

  // Strip anything that could contain secrets
  delete obj.pin;
  delete obj.token;
  delete obj.SCRIPT_TOKEN;
  delete obj.scriptToken;

  // If target exists, keep only id/date
  if (obj.target && typeof obj.target === "object") {
    obj.target = {
      id: obj.target.id,
      date: obj.target.date,
    };
  }

  return obj;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiOk | ApiErr>,
) {
  try {
    if (!SCRIPT_URL || !SCRIPT_TOKEN) {
      return res
        .status(500)
        .json({ ok: false, error: "Missing SCRIPT_URL or SCRIPT_TOKEN" });
    }

    /* =======================
       GET
    ======================= */
    if (req.method === "GET") {
      const action = String(req.query.action || "").trim();

      if (!action) {
        return res.status(400).json({ ok: false, error: "Missing action" });
      }

      if (action === "cycleGet") {
        const url = buildScriptUrl({ action: "cycleGet" });
        const { status, json } = await fetchJson(url);
        return res.status(status).json(json);
      }

      // Only pass through known query keys to avoid Next's query shape weirdness
      const room = String(req.query.room || "").trim();
      const house = String(req.query.house || "").trim();
      const limit = req.query.limit ? String(req.query.limit) : "";
      const limitPerRoom = req.query.limitPerRoom
        ? String(req.query.limitPerRoom)
        : "";

      const url = buildScriptUrl({
        action,
        room,
        house,
        limit,
        limitPerRoom,
      });

      const { status, json } = await fetchJson(url);
      return res.status(status).json(json);
    }

    /* =======================
       POST
    ======================= */
    if (req.method === "POST") {
      const action = getAction(req);
      const pin = getPin(req);
      const actor = actorForPin(pin);
      const debug = wantsDebug(req, pin);

      if (!action) {
        return res.status(400).json({ ok: false, error: "Missing action" });
      }

      // Admin-only actions
      if (action === "approve" || action === "cycleSet") {
        if (!isAdminPin(pin)) {
          return res
            .status(401)
            .json({ ok: false, error: "Unauthorized (admin PIN required)" });
        }

        // -------- cycleSet --------
        if (action === "cycleSet") {
          const month = String(req.body?.month || "").trim();
          if (!isMonthKey(month)) {
            return res.status(400).json({
              ok: false,
              error: "Invalid month. Expected YYYY-MM.",
            });
          }

          const { status, json } = await scriptCycleSet(month, actor);

          if (debug) {
            return res.status(status).json({
              ...(json || {}),
              debug: {
                forwarded: sanitizeForDebug({
                  action: "cycleSet",
                  month,
                  actor,
                }),
              },
            });
          }

          return res.status(status).json(json);
        }

        // -------- approve (next month) --------
        if (action === "approve") {
          const current =
            typeof req.body?.currentCycleKey === "string" &&
            isMonthKey(req.body.currentCycleKey)
              ? req.body.currentCycleKey
              : monthKey();

          const next = nextMonth(current);
          const { status, json } = await scriptCycleSet(next, actor);

          // If Apps Script failed, don't pretend success
          if (!json?.ok || status >= 400) {
            return res.status(status).json(json);
          }

          const out: any = {
            ok: true,
            nextMonthKey: next,
            message: `Approved ✅ Cycle moved to ${next}`,
            backend: json,
          };

          if (debug) {
            out.debug = {
              forwarded: sanitizeForDebug({
                action: "cycleSet",
                month: next,
                actor,
              }),
            };
          }

          return res.status(200).json(out);
        }
      }

      // Everything else: any valid user PIN (admin pin also allowed)
      if (!isUserPin(pin)) {
        return res
          .status(401)
          .json({ ok: false, error: "Unauthorized (bad PIN)" });
      }

      // -------- pass-through write to Apps Script --------
      // IMPORTANT: attach actor name (for logs) before forwarding
      const forwardedBody: Record<string, any> = { ...(req.body || {}) };

      // If the client mistakenly sends pin in body, strip it out so it never hits Sheets
      if ("pin" in forwardedBody) delete forwardedBody.pin;

      // Normalize risky fields before forwarding (prevents edit => append bugs)
      normalizeForwardedBody(forwardedBody);

      // Add audit fields (Apps Script can pick whichever it uses)
      if (actor) {
        forwardedBody.actor = actor;
        forwardedBody.by = actor;
      }

      const url = buildScriptUrl({});
      const { status, json } = await fetchJson(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(forwardedBody),
      });

      // Debug wrapper (admin-only)
      if (debug) {
        return res.status(status).json({
          ok: true,
          upstreamStatus: status,
          upstream: json,
          debug: {
            forwarded: sanitizeForDebug(forwardedBody),
          },
        });
      }

      return res.status(status).json(json);
    }

    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (err: any) {
    return res
      .status(500)
      .json({ ok: false, error: err?.message || String(err) });
  }
}
