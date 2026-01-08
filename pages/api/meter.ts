import type { NextApiRequest, NextApiResponse } from "next";

const SCRIPT_URL = process.env.SCRIPT_URL;
const VTPT_PIN = process.env.VTPT_PIN;

type ApiOk<T> = { ok: true; data: T };
type ApiErr = { ok: false; error: string };

function getHeaderPin(req: NextApiRequest): string {
  const raw = req.headers["x-vtpt-pin"];
  const pin = Array.isArray(raw) ? raw[0] : raw;
  return (pin || "").trim();
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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiOk<any> | ApiErr>
) {
  try {
    if (!SCRIPT_URL) {
      return res.status(500).json({ ok: false, error: "Missing SCRIPT_URL" });
    }

    // =========================
    // READ (no PIN required)
    // =========================
    if (req.method === "GET") {
      const action = String(req.query.action || "");
      const room = String(req.query.room || "").trim();

      if (!action)
        return res.status(400).json({ ok: false, error: "Missing action" });
      if (!room)
        return res.status(400).json({ ok: false, error: "Missing room" });

      const url = new URL(SCRIPT_URL);
      url.searchParams.set("action", action);
      url.searchParams.set("room", room);

      if (req.query.limit)
        url.searchParams.set("limit", String(req.query.limit));
      if (req.query.house)
        url.searchParams.set("house", String(req.query.house));

      const { status, json } = await fetchJson(url.toString());
      return res.status(status).json(json);
    }

    // =========================
    // WRITE (HARD LOCK: PIN REQUIRED)
    // =========================
    if (req.method === "POST") {
      // 🔒 HARD LOCK: server MUST be configured with a PIN
      if (!VTPT_PIN) {
        return res.status(500).json({
          ok: false,
          error:
            "Server not configured: VTPT_PIN is missing. Writes are disabled.",
        });
      }

      const pin = getHeaderPin(req);
      if (!pin || pin !== VTPT_PIN) {
        return res
          .status(401)
          .json({ ok: false, error: "Unauthorized (bad PIN)" });
      }

      const { room, dien, nuoc, note } = req.body || {};
      const roomStr = String(room || "").trim();

      if (!roomStr)
        return res.status(400).json({ ok: false, error: "Missing room" });
      if (!Number.isFinite(Number(dien)))
        return res.status(400).json({ ok: false, error: "Invalid dien" });
      if (!Number.isFinite(Number(nuoc)))
        return res.status(400).json({ ok: false, error: "Invalid nuoc" });

      const payload = {
        action: "save",
        room: roomStr,
        dien: Number(dien),
        nuoc: Number(nuoc),
        note: typeof note === "string" ? note : "",
      };

      const { status, json } = await fetchJson(SCRIPT_URL, {
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
