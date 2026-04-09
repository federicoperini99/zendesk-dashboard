// api/stats.js
import { Redis } from "@upstash/redis";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate");
  try {
    const kv = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
    const raw = await kv.get("dashboard_stats");
    const lastTs = await kv.get("last_refresh_ts");
    if (!raw) {
      return res.status(202).json({ status:"not_ready", message:"Dati non ancora disponibili. Clicca Aggiorna ora." });
    }
    const stats = typeof raw === "string" ? JSON.parse(raw) : raw;
    res.status(200).json({ status:"ok", stats, last_refresh_ts: lastTs });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
