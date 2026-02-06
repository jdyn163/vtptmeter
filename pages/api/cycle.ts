// pages/api/cycle.ts
import type { NextApiRequest, NextApiResponse } from "next";

const SCRIPT_URL = process.env.VTPT_SCRIPT_URL; // e.g. https://script.google.com/macros/s/XXXXX/exec
const TOKEN = process.env.VTPT_SCRIPT_TOKEN; // vtpt_ew2026_9fA7kQx_secret

function isMonthKey(s: string) {
  return /^\d{4}-\d{2}$/.test((s || "").trim());
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (!SCRIPT_URL || !TOKEN) {
      return res.status(500).json({
        ok: false,
        error: "Missing env: VTPT_SCRIPT_URL or VTPT_SCRIPT_TOKEN",
      });
    }

    // GET -> cycleGet
    if (req.method === "GET") {
      const url = `${SCRIPT_URL}?action=cycleGet&token=${encodeURIComponent(
        TOKEN,
      )}`;

      const r = await fetch(url, { method: "GET" });
      const text = await r.text();

      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        return res
          .status(502)
          .json({ ok: false, error: "Bad upstream JSON", raw: text });
      }

      if (!r.ok || !json?.ok) {
        return res.status(502).json({
          ok: false,
          error: json?.error || "Upstream error",
          upstream: json,
        });
      }

      return res.status(200).json({ ok: true, data: String(json.data || "") });
    }

    // POST -> cycleSet
    if (req.method === "POST") {
      const month = String((req.body?.month ?? "") as string).trim();
      if (!isMonthKey(month)) {
        return res
          .status(400)
          .json({ ok: false, error: "Invalid month. Expected YYYY-MM." });
      }

      const url = `${SCRIPT_URL}?token=${encodeURIComponent(TOKEN)}`;

      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cycleSet", month }),
      });

      const text = await r.text();
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        return res
          .status(502)
          .json({ ok: false, error: "Bad upstream JSON", raw: text });
      }

      if (!r.ok || !json?.ok) {
        return res.status(502).json({
          ok: false,
          error: json?.error || "Upstream error",
          upstream: json,
        });
      }

      return res.status(200).json({ ok: true, data: String(json.data || "") });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
