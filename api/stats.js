// api/stats.js
// Restituisce le statistiche salvate su Vercel KV al frontend.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate");

  try {
    const { kv } = await import("@vercel/kv");
    const stats = await kv.get("dashboard_stats");
    const lastTs = await kv.get("last_refresh_ts");

    if (!stats) {
      return res.status(202).json({
        status: "not_ready",
        message: "Dati non ancora disponibili. Clicca 'Aggiorna ora' per il primo caricamento."
      });
    }

    res.status(200).json({ status: "ok", stats, last_refresh_ts: lastTs });

  } catch (e) {
    console.error("Stats error:", e);
    res.status(500).json({ error: e.message });
  }
}
