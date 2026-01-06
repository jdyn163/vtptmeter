import type { NextApiRequest, NextApiResponse } from "next";

const SCRIPT_URL = process.env.SCRIPT_URL as string;
const SCRIPT_TOKEN = process.env.SCRIPT_TOKEN as string;

// ✅ Option 1: simple PIN gate for writes
const VTPT_PIN = process.env.VTPT_PIN as string;

// simple fetch timeout helper
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  ms = 12000
) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const r = await fetch(url, { ...options, signal: controller.signal });
    return r;
  } finally {
    clearTimeout(id);
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    if (!SCRIPT_URL || !SCRIPT_TOKEN) {
      return res.status(500).json({
        ok: false,
        error: "Missing SCRIPT_URL or SCRIPT_TOKEN in .env.local",
      });
    }

    // (Optional) You can require VTPT_PIN only for POST.
    // If you want to require it for GET too, move this check above the GET/POST split.
    if (req.method === "POST") {
      if (!VTPT_PIN) {
        return res.status(500).json({
          ok: false,
          error: "Missing VTPT_PIN in .env.local",
        });
      }

      const pin = String(req.headers["x-vtpt-pin"] || "").trim();
      if (pin !== VTPT_PIN) {
        return res
          .status(401)
          .json({ ok: false, error: "Unauthorized (bad PIN)" });
      }
    }

    if (req.method === "GET") {
      const action = String(req.query.action || "latest").trim();

      // ✅ batch latest for an entire house (A0, A1, ...)
      if (action === "houseLatest") {
        const house = String(req.query.house || "").trim();
        if (!house)
          return res.status(400).json({ ok: false, error: "Missing house" });

        const url =
          `${SCRIPT_URL}?action=houseLatest` +
          `&house=${encodeURIComponent(house)}` +
          `&token=${encodeURIComponent(SCRIPT_TOKEN)}`;

        const r = await fetchWithTimeout(url);
        const data = await r.json();
        return res.status(200).json(data);
      }

      // ✅ batch history per room for an entire house
      if (action === "houseHistory") {
        const house = String(req.query.house || "").trim();
        if (!house)
          return res.status(400).json({ ok: false, error: "Missing house" });

        const limitPerRoom = String(req.query.limitPerRoom || "24").trim();

        const url =
          `${SCRIPT_URL}?action=houseHistory` +
          `&house=${encodeURIComponent(house)}` +
          `&limitPerRoom=${encodeURIComponent(limitPerRoom)}` +
          `&token=${encodeURIComponent(SCRIPT_TOKEN)}`;

        const r = await fetchWithTimeout(url);
        const data = await r.json();
        return res.status(200).json(data);
      }

      // existing room-based actions
      const room = String(req.query.room || "").trim();
      if (!room)
        return res.status(400).json({ ok: false, error: "Missing room" });

      const limit = String(req.query.limit || "20").trim();

      let url =
        `${SCRIPT_URL}?action=${encodeURIComponent(action)}` +
        `&room=${encodeURIComponent(room)}` +
        `&token=${encodeURIComponent(SCRIPT_TOKEN)}`;

      if (action === "history") {
        url += `&limit=${encodeURIComponent(limit)}`;
      }

      const r = await fetchWithTimeout(url);
      const data = await r.json();
      return res.status(200).json(data);
    }

    if (req.method === "POST") {
      const url = `${SCRIPT_URL}?token=${encodeURIComponent(SCRIPT_TOKEN)}`;

      const r = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req.body),
        },
        15000
      );

      const data = await r.json();
      return res.status(200).json(data);
    }

    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (err: any) {
    const msg = String(err?.name === "AbortError" ? "Upstream timeout" : err);
    return res.status(500).json({ ok: false, error: msg });
  }
}
