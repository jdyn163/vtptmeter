import type { NextApiRequest, NextApiResponse } from "next";

const SCRIPT_URL = process.env.SCRIPT_URL;
const SCRIPT_TOKEN = process.env.SCRIPT_TOKEN; // required by your Apps Script

// Personal PIN list: "1111:Masie,2222:Brother,3333:Thuan"
const VTPT_PINS = process.env.VTPT_PINS;

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: string };

function getHeaderPin(req: NextApiRequest): string {
  const raw = req.headers["x-vtpt-pin"];
  const pin = Array.isArray(raw) ? raw[0] : raw;
  return (pin || "").trim();
}

// allow pin from body too (for approve sheet)
function getAnyPin(req: NextApiRequest): string {
  const headerPin = getHeaderPin(req);
  if (headerPin) return headerPin;

  const bodyPin =
    req.body && typeof req.body.pin === "string" ? req.body.pin.trim() : "";
  return bodyPin;
}

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

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(text || `Upstream error ${res.status}`);
  }

  return { status: res.status, json };
}

function buildScriptUrl(params: Record<string, string>) {
  if (!SCRIPT_URL) throw new Error("Missing SCRIPT_URL");
  if (!SCRIPT_TOKEN) throw new Error("Missing SCRIPT_TOKEN");

  const url = new URL(SCRIPT_URL);
  url.searchParams.set("token", SCRIPT_TOKEN);

  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v).length) {
      url.searchParams.set(k, String(v));
    }
  }

  return url.toString();
}

function hasFiniteNumber(x: any) {
  return x !== null && x !== undefined && Number.isFinite(Number(x));
}

// ===== cycle helpers =====
function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function isMonthKey(s: string) {
  return /^\d{4}-\d{2}$/.test((s || "").trim());
}

function nextMonthKeyFrom(key: string) {
  const m = /^(\d{4})-(\d{2})$/.exec((key || "").trim());
  if (!m) return monthKey(new Date());

  const y = Number(m[1]);
  const mo = Number(m[2]); // 1..12
  if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) {
    return monthKey(new Date());
  }

  const d = new Date(y, mo - 1, 1);
  d.setMonth(d.getMonth() + 1);
  return monthKey(d);
}

function prevMonthKeyFrom(key: string) {
  const m = /^(\d{4})-(\d{2})$/.exec((key || "").trim());
  if (!m) return monthKey(new Date());

  const y = Number(m[1]);
  const mo = Number(m[2]); // 1..12
  if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) {
    return monthKey(new Date());
  }

  const d = new Date(y, mo - 1, 1);
  d.setMonth(d.getMonth() - 1);
  return monthKey(d);
}
// =========================

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiOk<any> | ApiErr | any>,
) {
  try {
    if (!SCRIPT_URL) {
      return res.status(500).json({ ok: false, error: "Missing SCRIPT_URL" });
    }
    if (!SCRIPT_TOKEN) {
      return res.status(500).json({ ok: false, error: "Missing SCRIPT_TOKEN" });
    }

    // =========================
    // GET (READ)
    // =========================
    if (req.method === "GET") {
      const action = String(req.query.action || "").trim();
      const room = String(req.query.room || "").trim();
      const house = String(req.query.house || "").trim();
      const limit = req.query.limit ? String(req.query.limit) : "";
      const limitPerRoom = req.query.limitPerRoom
        ? String(req.query.limitPerRoom)
        : "";

      if (!action) {
        return res.status(400).json({ ok: false, error: "Missing action" });
      }

      const houseActions = new Set(["houseLatest", "houseHistory"]);
      const roomActions = new Set(["latest", "history", "log"]);

      if (houseActions.has(action) && !house) {
        return res.status(400).json({ ok: false, error: "Missing house" });
      }
      if (roomActions.has(action) && !room) {
        return res.status(400).json({ ok: false, error: "Missing room" });
      }

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

    // =========================
    // POST
    // =========================
    if (req.method === "POST") {
      const qAction = String(req.query.action || "").trim();

      if (!VTPT_PINS) {
        return res.status(500).json({
          ok: false,
          error:
            "Server not configured: VTPT_PINS is missing. Writes are disabled.",
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

      const pin = getAnyPin(req);
      const actor = pin ? pins[pin] : undefined;

      if (!actor) {
        return res
          .status(401)
          .json({ ok: false, error: "Unauthorized (bad PIN)" });
      }

      // =========================
      // POST approve / rollback / set (local-only)
      // =========================
      if (qAction === "approve") {
        // Only Masie can control cycle
        if (actor !== "Masie") {
          return res.status(403).json({
            ok: false,
            error: "Access denied. Only Masie can approve the month.",
          });
        }

        const body = req.body || {};
        const mode =
          typeof body.mode === "string" ? body.mode.trim() : "approve";

        const currentCycleKey =
          typeof body.currentCycleKey === "string"
            ? body.currentCycleKey.trim()
            : "";

        const base = isMonthKey(currentCycleKey)
          ? currentCycleKey
          : monthKey(new Date());

        if (mode === "rollback") {
          const prev = prevMonthKeyFrom(base);
          return res.status(200).json({
            ok: true,
            nextMonthKey: prev,
            message: `Rollback ✅ Cycle moved to ${prev}.`,
          });
        }

        if (mode === "set") {
          const target =
            typeof body.targetMonthKey === "string"
              ? body.targetMonthKey.trim()
              : "";
          if (!isMonthKey(target)) {
            return res.status(400).json({
              ok: false,
              error: "Invalid targetMonthKey. Expected YYYY-MM (e.g. 2026-02).",
            });
          }
          return res.status(200).json({
            ok: true,
            nextMonthKey: target,
            message: `Set ✅ Cycle moved to ${target}.`,
          });
        }

        // default: approve -> next month
        const next = nextMonthKeyFrom(base);
        return res.status(200).json({
          ok: true,
          nextMonthKey: next,
          message: `Approved ✅ Cycle moved to ${next}.`,
        });
      }

      // =========================
      // POST (WRITE): save / update / delete
      // =========================
      const body = req.body || {};
      const actionRaw = String(body.action || "save").trim();
      const action =
        actionRaw === "update" || actionRaw === "delete" ? actionRaw : "save";

      const roomStr = String(body.room || "").trim();
      if (!roomStr)
        return res.status(400).json({ ok: false, error: "Missing room" });

      const target = body.target || undefined;
      const targetId =
        target && target.id !== undefined ? Number(target.id) : undefined;
      const targetDate =
        target && target.date !== undefined ? String(target.date).trim() : "";

      if ((action === "update" || action === "delete") && !target) {
        return res
          .status(400)
          .json({ ok: false, error: "Missing target for update/delete" });
      }
      if ((action === "update" || action === "delete") && !targetDate) {
        return res
          .status(400)
          .json({ ok: false, error: "Missing target.date for update/delete" });
      }
      if (
        (action === "update" || action === "delete") &&
        (targetId === undefined || !Number.isFinite(targetId))
      ) {
        return res.status(400).json({
          ok: false,
          error: "Missing/invalid target.id for update/delete",
        });
      }

      if (action !== "delete") {
        const dienProvided = hasFiniteNumber(body.dien);
        const nuocProvided = hasFiniteNumber(body.nuoc);

        if (!dienProvided && !nuocProvided) {
          return res.status(400).json({
            ok: false,
            error: "Provide at least one of dien or nuoc",
          });
        }
      }

      const noteStr = typeof body.note === "string" ? body.note.trim() : "";

      const url = buildScriptUrl({});

      const payload: any = {
        action,
        room: roomStr,
        actor,
      };

      if (action === "delete") {
        payload.target = { id: targetId, date: targetDate };
      } else {
        payload.dien = hasFiniteNumber(body.dien) ? Number(body.dien) : null;
        payload.nuoc = hasFiniteNumber(body.nuoc) ? Number(body.nuoc) : null;
        payload.note = noteStr;

        if (action === "update") {
          payload.target = { id: targetId, date: targetDate };
        }
      }

      const { status, json } = await fetchJson(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      return res.status(status).json(json);
    }

    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (err: any) {
    return res
      .status(500)
      .json({ ok: false, error: err?.message || String(err) });
  }
}
