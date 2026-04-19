// api/chat.js
// Proxy alla Messages API di Anthropic per il chatbot dashboard.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")  return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY non configurata" });
  }

  try {
    const { messages, system } = req.body || {};
    if (!Array.isArray(messages) || !messages.length) {
      return res.status(400).json({ error: "messages mancante" });
    }

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        system: system || "Sei un analista customer service senior per Espresso Coffee Shop SRL.",
        messages
      })
    });

    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || "Anthropic error");
    return res.status(200).json({ text: data.content?.[0]?.text || "" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
