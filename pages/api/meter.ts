// pages/api/meter.ts
import type { NextApiRequest, NextApiResponse } from "next";

const SCRIPT_URL = process.env.SCRIPT_URL;
const SCRIPT_TOKEN = process.env.SCRIPT_TOKEN;

// Pins format: "0511,2222,3333"
// ONLY numbers matter now
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

function getPin(req: NextApiRequest): string {
  const headerPin = req.headers["x-vtpt-pin"];
  if (typeof headerPin === "string") return headerPin.trim();
  if (req.body && typeof req.body.pin === "string") return req.body.pin.trim();
  return "";
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

async function scriptCycleSet(month: string) {
  const url = buildScriptUrl({});
  const payload = { action: "cycleSet", month };

  return fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
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
      const action = String(req.query.action || "").trim();
      const pin = getPin(req);

      if (!VTPT_ADMIN_PINS.includes(pin)) {
        return res
          .status(401)
          .json({ ok: false, error: "Unauthorized (bad PIN)" });
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

        const { status, json } = await scriptCycleSet(month);
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
        const { status, json } = await scriptCycleSet(next);

        // If Apps Script failed, don't pretend success
        if (!json?.ok || status >= 400) {
          return res.status(status).json(json);
        }

        return res.status(200).json({
          ok: true,
          nextMonthKey: next,
          message: `Approved ✅ Cycle moved to ${next}`,
          backend: json,
        });
      }

      // -------- fallback write --------
      const url = buildScriptUrl({});
      const { status, json } = await fetchJson(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
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
