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

function isMonthKey(s: any) {
  return /^\d{4}-\d{2}$/.test(String(s || "").trim());
}

function requirePinActor(req: NextApiRequest) {
  if (!VTPT_PINS) {
    return {
      ok: false as const,
      status: 500,
      error:
        "Server not configured: VTPT_PINS is missing. Writes are disabled.",
    };
  }

  const pins = parsePins(VTPT_PINS);
  if (!Object.keys(pins).length) {
    return {
      ok: false as const,
      status: 500,
      error:
        "Server not configured: VTPT_PINS is empty/invalid (expected '1111:Masie,2222:Brother').",
    };
  }

  const pin = getHeaderPin(req);
  const actor = pin ? pins[pin] : undefined;

  if (!actor) {
    return {
      ok: false as const,
      status: 401,
      error: "Unauthorized (bad PIN)",
    };
  }

  return { ok: true as const, actor };
}

function mapAction(actionRaw: string) {
  const a = String(actionRaw || "").trim();

  // Backward compatibility aliases (UI or old links might call these)
  const alias: Record<string, string> = {
    // Some UIs called these, but Apps Script uses houseCycleLatest
    houseLatestCycle: "houseCycleLatest",
    houseHistoryCycle: "houseHistory", // no direct "cycle history" for whole house in script
  };

  return alias[a] || a;
}

function normalizeCyclesList(input: any): string[] {
  // Accept common shapes:
  // - ["2026-01","2026-02"]
  // - { cycles: [...] }
  // - { data: [...] }
  let arr: any[] = [];
  if (Array.isArray(input)) arr = input;
  else if (input && Array.isArray((input as any).cycles))
    arr = (input as any).cycles;
  else if (input && Array.isArray((input as any).data))
    arr = (input as any).data;

  const out = new Set<string>();
  for (const v of arr) {
    const s = String(v || "").trim();
    if (isMonthKey(s)) out.add(s);
  }
  return Array.from(out).sort();
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiOk<any> | ApiErr>,
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
      const action = mapAction(String(req.query.action || "").trim());

      const room = String(req.query.room || "").trim();
      const house = String(req.query.house || "").trim();

      const limit = req.query.limit ? String(req.query.limit) : "";
      const limitPerRoom = req.query.limitPerRoom
        ? String(req.query.limitPerRoom)
        : "";

      // cycle param naming:
      // - your Apps Script uses "cycle" for historyByCycle
      // - some callers may send "month" (older code)
      const cycle = req.query.cycle
        ? String(req.query.cycle).trim()
        : req.query.month
          ? String(req.query.month).trim()
          : "";

      if (!action) {
        return res.status(400).json({ ok: false, error: "Missing action" });
      }

      // ✅ New: cyclesGet (unique cycles that exist in the sheet data)
      // This is used by index page to show 2026-01 / 2026-02 even if they aren't "current".
      if (action === "cyclesGet") {
        const url = buildScriptUrl({ action: "cyclesGet" });
        const { status, json } = await fetchJson(url);

        // If Apps Script already returns ok:true with data, pass-through.
        // But we normalize to only valid YYYY-MM strings in case upstream returns extra stuff.
        if (json && json.ok) {
          const cycles = normalizeCyclesList(json.data ?? json);
          return res.status(status).json({ ok: true, data: cycles });
        }

        return res.status(status).json(json);
      }

      const needsRoom = new Set([
        "latest",
        "history",
        "log",
        "latestCycle",
        "historyByCycle",
      ]);
      const needsHouse = new Set([
        "houseLatest",
        "houseHistory",
        "houseCycleLatest",
      ]);

      if (needsHouse.has(action) && !house) {
        return res.status(400).json({ ok: false, error: "Missing house" });
      }
      if (needsRoom.has(action) && !room) {
        return res.status(400).json({ ok: false, error: "Missing room" });
      }

      // Only validate cycle if it exists (some actions don't need it)
      if ((action === "historyByCycle" || action === "latestCycle") && cycle) {
        if (!isMonthKey(cycle)) {
          return res.status(400).json({
            ok: false,
            error: "Invalid cycle. Expected YYYY-MM (example: 2026-03).",
          });
        }
      }

      const url = buildScriptUrl({
        action,
        room,
        house,
        limit,
        limitPerRoom,
        cycle, // NOTE: Apps Script expects "cycle" (not "month")
      });

      const { status, json } = await fetchJson(url);
      return res.status(status).json(json);
    }

    // =========================
    // POST (WRITE): save / update / delete / cycleSet
    // =========================
    if (req.method === "POST") {
      const body = req.body || {};
      const actionRaw = String(body.action || "save").trim();

      if (actionRaw === "cycleSet") {
        const auth = requirePinActor(req);
        if (!auth.ok) {
          return res.status(auth.status).json({ ok: false, error: auth.error });
        }

        const month = String(body.month || "").trim();
        if (!isMonthKey(month)) {
          return res.status(400).json({
            ok: false,
            error: "Invalid month. Expected YYYY-MM (example: 2026-03).",
          });
        }

        const url = buildScriptUrl({});

        const { status, json } = await fetchJson(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "cycleSet",
            month,
            actor: auth.actor,
          }),
        });

        return res.status(status).json(json);
      }

      const auth = requirePinActor(req);
      if (!auth.ok) {
        return res.status(auth.status).json({ ok: false, error: auth.error });
      }

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

      // cycle is OPTIONAL. Your Apps Script ignores it for SAVE and uses script cycle.
      // For UPDATE, Apps Script keeps the original row cycle anyway.
      const cycle = typeof body.cycle === "string" ? body.cycle.trim() : "";
      if (cycle && !isMonthKey(cycle)) {
        return res.status(400).json({
          ok: false,
          error: "Invalid cycle. Expected YYYY-MM (example: 2026-03).",
        });
      }

      const url = buildScriptUrl({});

      const payload: any = {
        action,
        room: roomStr,
        actor: auth.actor,
      };

      if (action === "delete") {
        payload.target = { id: targetId, date: targetDate };
      } else {
        payload.dien = hasFiniteNumber(body.dien) ? Number(body.dien) : null;
        payload.nuoc = hasFiniteNumber(body.nuoc) ? Number(body.nuoc) : null;
        payload.note = noteStr;

        // include cycle only if present (harmless if Apps Script ignores)
        if (cycle) payload.cycle = cycle;

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
