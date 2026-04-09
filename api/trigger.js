// api/trigger.js
// Avvia un refresh manuale. Chiamato dal bottone "Aggiorna ora" nella dashboard.
// Per sicurezza usa un secret configurabile come variabile d'ambiente.

const CRON_SECRET = process.env.CRON_SECRET || "";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  // Chiama /api/refresh internamente passando il secret
  try {
    const baseUrl = `https://${req.headers.host}`;
    const refreshRes = await fetch(`${baseUrl}/api/refresh`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${CRON_SECRET}`,
        "x-vercel-cron": "1",
      }
    });
    const data = await refreshRes.json();
    res.status(refreshRes.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
