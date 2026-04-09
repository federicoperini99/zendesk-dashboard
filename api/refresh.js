// api/refresh.js
// Chiamata ogni notte alle 3:00 (cron) oppure manualmente dal bottone.
// Scarica ticket + agenti da Zendesk, calcola statistiche, salva su Vercel KV.

const SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN;
const EMAIL     = process.env.ZENDESK_EMAIL;
const TOKEN     = process.env.ZENDESK_TOKEN;
const CRON_SECRET = process.env.CRON_SECRET || "";
const SLA_FRT_H   = 4;
const BACKLOG_H   = 8;

function zdAuth() {
  return "Basic " + Buffer.from(`${EMAIL}/token:${TOKEN}`).toString("base64");
}

async function zdFetch(url) {
  const res = await fetch(url, {
    headers: { "Authorization": zdAuth(), "Content-Type": "application/json" }
  });
  if (!res.ok) throw new Error(`Zendesk ${res.status} on ${url}`);
  return res.json();
}

async function fetchAllAgents() {
  let url = `https://${SUBDOMAIN}.zendesk.com/api/v2/users.json?role=agent&per_page=100`;
  const results = [];
  while (url) {
    const data = await zdFetch(url);
    results.push(...(data.users || []).filter(u => !u.suspended));
    url = data.next_page || null;
  }
  return results;
}

async function fetchAllTicketsIncremental(startTime = 0) {
  let url = `https://${SUBDOMAIN}.zendesk.com/api/v2/incremental/tickets.json?start_time=${startTime}`;
  const results = [];
  while (url) {
    const data = await zdFetch(url);
    results.push(...(data.tickets || []));
    url = data.end_of_stream ? null : (data.next_page || null);
  }
  return results;
}

async function fetchMetricsBatch(ids) {
  if (!ids.length) return [];
  const url = `https://${SUBDOMAIN}.zendesk.com/api/v2/tickets/show_many.json?ids=${ids.join(",")}&include=metric_sets`;
  const data = await zdFetch(url);
  return data.tickets || [];
}

function parseDate(s) {
  if (!s) return null;
  try { return new Date(s); } catch { return null; }
}

function safeAvg(arr) {
  return arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10 : null;
}

// ── Calcola tutte le statistiche ──────────────────────────────────────────────
function computeStats(agents, tickets, metricsMap) {
  const now = new Date();

  // Mappa agenti per id
  const agentMap = {};
  for (const a of agents) agentMap[a.id] = a;

  // Classifica ticket con/senza risposta
  const withReply = [], noReply = [];
  for (const t of tickets) {
    if (t.status === "deleted") continue;
    const ms = metricsMap[t.id] || {};
    const frt = ms.reply_time_in_minutes;
    let hasReply = false;
    if (frt && typeof frt === "object") hasReply = !!(frt.business || frt.calendar);
    else if (typeof frt === "number")   hasReply = frt > 0;
    if (hasReply || (ms.replies || 0) > 0) withReply.push(t);
    else noReply.push(t);
  }

  // Statistiche per agente
  const stats = {};
  for (const a of agents) {
    stats[a.id] = {
      id: a.id, name: a.name, email: a.email || "",
      created_at: a.created_at || "",
      total: 0, open: 0, solved: 0, closed: 0, pending: 0, new_st: 0,
      auto_closed: 0,
      frt_hours: [], res_hours: [],
      sla_ok: 0, sla_breach: 0,
      monthly: {}, hourly: {}, weekday: {},
      channels: {}, tags: {}, priority: {},
      sat_good: 0, sat_bad: 0, reopened: 0,
    };
  }

  const inc = (obj, key) => { obj[key] = (obj[key] || 0) + 1; };

  for (const t of noReply) {
    const aid = t.assignee_id;
    if (stats[aid]) stats[aid].auto_closed++;
  }

  for (const t of withReply) {
    const aid = t.assignee_id;
    if (!stats[aid]) continue;
    const s = stats[aid];
    s.total++;
    const st = t.status || "";
    if      (st === "open")    s.open++;
    else if (st === "new")     s.new_st++;
    else if (st === "solved")  s.solved++;
    else if (st === "closed")  s.closed++;
    else if (st === "pending") s.pending++;

    inc(s.priority, t.priority || "normal");
    for (const tag of (t.tags || [])) inc(s.tags, tag);
    inc(s.channels, (t.via?.channel) || "unknown");

    const sat = t.satisfaction_rating?.score || "";
    if (sat === "good") s.sat_good++; else if (sat === "bad") s.sat_bad++;

    const created = parseDate(t.created_at);
    if (created) {
      const ym = created.toISOString().slice(0, 7);
      inc(s.monthly, ym);
      inc(s.hourly,  created.getUTCHours());
      inc(s.weekday, created.getUTCDay() === 0 ? 6 : created.getUTCDay() - 1); // 0=Mon
    }

    const ms = metricsMap[t.id] || {};
    const frt = ms.reply_time_in_minutes;
    let frtMin = null;
    if (frt && typeof frt === "object") frtMin = frt.business || frt.calendar;
    else if (typeof frt === "number" && frt > 0) frtMin = frt;
    if (frtMin) {
      const frtH = Math.round(frtMin / 60 * 100) / 100;
      s.frt_hours.push(frtH);
      if (frtH <= SLA_FRT_H) s.sla_ok++; else s.sla_breach++;
    }

    const res = ms.full_resolution_time_in_minutes;
    let resMin = null;
    if (res && typeof res === "object") resMin = res.business || res.calendar;
    else if (typeof res === "number" && res > 0) resMin = res;
    if (resMin) s.res_hours.push(Math.round(resMin / 60 * 100) / 100);

    if ((ms.reopens || 0) > 0) s.reopened++;
  }

  // Aggrega
  const display = [];
  for (const s of Object.values(stats)) {
    if (s.total === 0 && s.auto_closed === 0) continue;
    s.avg_frt    = safeAvg(s.frt_hours);
    s.avg_res    = safeAvg(s.res_hours);
    s.solve_rate = s.total ? Math.round((s.solved + s.closed) / s.total * 100) : 0;
    const slaTot = s.sla_ok + s.sla_breach;
    s.sla_pct    = slaTot ? Math.round(s.sla_ok / slaTot * 100) : null;
    const satTot = s.sat_good + s.sat_bad;
    s.csat       = satTot ? Math.round(s.sat_good / satTot * 100) : null;
    const sortedFrt = [...s.frt_hours].sort((a, b) => a - b);
    s.frt_p50    = sortedFrt[Math.floor(sortedFrt.length / 2)] || null;
    s.frt_p90    = sortedFrt[Math.floor(sortedFrt.length * 0.9)] || null;
    s.top_tags   = Object.entries(s.tags).sort((a, b) => b[1] - a[1]).slice(0, 8);
    delete s.frt_hours; delete s.res_hours; delete s.tags;
    display.push(s);
  }
  display.sort((a, b) => a.created_at.localeCompare(b.created_at));

  // Volume mensile globale
  const monthlyWith = {}, monthlyWithout = {};
  for (const t of withReply) {
    const d = parseDate(t.created_at);
    if (d) { const m = d.toISOString().slice(0,7); monthlyWith[m] = (monthlyWith[m]||0)+1; }
  }
  for (const t of noReply) {
    const d = parseDate(t.created_at);
    if (d) { const m = d.toISOString().slice(0,7); monthlyWithout[m] = (monthlyWithout[m]||0)+1; }
  }
  const allMonths = [...new Set([...Object.keys(monthlyWith), ...Object.keys(monthlyWithout)])].sort();

  // Rolling 3m
  const rolling3 = {};
  allMonths.forEach((m, i) => {
    const win = allMonths.slice(Math.max(0, i-2), i+1).map(mm => (monthlyWith[mm]||0));
    rolling3[m] = Math.round(win.reduce((a,b)=>a+b,0)/win.length*10)/10;
  });

  // Backlog critico
  const backlog = [];
  for (const t of tickets) {
    if (!["open","new","pending"].includes(t.status)) continue;
    const created = parseDate(t.created_at);
    if (!created) continue;
    const hoursOpen = (now - created) / 3600000;
    if (hoursOpen < BACKLOG_H) continue;
    const ms = metricsMap[t.id] || {};
    const frt = ms.reply_time_in_minutes;
    const replied = (frt && typeof frt === "object" && (frt.business||frt.calendar)) ||
                    (typeof frt === "number" && frt > 0) || (ms.replies||0) > 0;
    if (!replied) {
      backlog.push({
        id: t.id, subject: t.subject || "(senza oggetto)",
        priority: t.priority || "normal", status: t.status,
        assignee: agentMap[t.assignee_id]?.name || "Non assegnato",
        hours_open: Math.round(hoursOpen * 10) / 10,
      });
    }
  }
  backlog.sort((a, b) => b.hours_open - a.hours_open);

  // Forecast
  const recentMonths = allMonths.slice(-12);
  let slope = 0, intercept = 0;
  if (recentMonths.length >= 3) {
    const n = recentMonths.length;
    const xs = recentMonths.map((_, i) => i);
    const ys = recentMonths.map(m => monthlyWith[m] || 0);
    const xm = xs.reduce((a,b)=>a+b)/n, ym = ys.reduce((a,b)=>a+b)/n;
    const num = xs.reduce((s,x,i)=>s+(x-xm)*(ys[i]-ym),0);
    const den = xs.reduce((s,x)=>s+(x-xm)**2,0);
    slope = den ? num/den : 0;
    intercept = ym - slope*xm;
  }
  const lastMonthDt = new Date(allMonths[allMonths.length-1] + "-01");
  const forecastMonths = [], forecastVals = [];
  for (let i = 1; i <= 6; i++) {
    const d = new Date(lastMonthDt); d.setMonth(d.getMonth() + i);
    forecastMonths.push(d.toISOString().slice(0,7));
    forecastVals.push(Math.max(Math.round((intercept + slope*(recentMonths.length+i-1))*10)/10, 0));
  }

  const recentAvg = recentMonths.slice(-3).reduce((s,m)=>s+(monthlyWith[m]||0),0) / 3;
  const activeAgents = display.filter(a => a.avg_per_month > 0 || a.total > 0).length || display.length;
  const capPerAgent  = Math.round(recentAvg / Math.max(activeAgents, 1) * 10) / 10;
  const threshold    = Math.round(capPerAgent * (activeAgents + 0.5));
  const breachMonth  = forecastMonths.find((m, i) => forecastVals[i] >= threshold) || null;

  // Totali
  const totalW  = withReply.length;
  const totalWO = noReply.length;
  const totalOpen   = withReply.filter(t => ["open","new"].includes(t.status)).length;
  const totalSolved = withReply.filter(t => ["solved","closed"].includes(t.status)).length;
  const totalPend   = withReply.filter(t => t.status === "pending").length;

  const teamFrt  = safeAvg(display.map(a=>a.avg_frt).filter(x=>x!=null));
  const teamRes  = safeAvg(display.map(a=>a.avg_res).filter(x=>x!=null));
  const teamSolv = safeAvg(display.map(a=>a.solve_rate));
  const teamSla  = safeAvg(display.map(a=>a.sla_pct).filter(x=>x!=null));

  return {
    generated_at: now.toISOString(),
    agents: display,
    allMonths,
    monthlyWith, monthlyWithout,
    rolling3,
    backlog: backlog.slice(0, 30),
    forecastMonths, forecastVals,
    breachMonth, slope,
    capPerAgent, activeAgents, threshold,
    totalW, totalWO, totalOpen, totalSolved, totalPend,
    teamFrt, teamRes, teamSolv, teamSla,
    slaFrtH: SLA_FRT_H,
    backlogH: BACKLOG_H,
  };
}

// ── Handler principale ────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Sicurezza: solo cron di Vercel o richieste con il secret
  const authHeader = req.headers["authorization"] || "";
  const isVercelCron = req.headers["x-vercel-cron"] === "1";
  const hasSecret = CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`;

  if (!isVercelCron && !hasSecret && req.method !== "GET") {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    console.log("Refresh started:", new Date().toISOString());

    // 1. Agenti
    const agents = await fetchAllAgents();
    console.log(`Agents: ${agents.length}`);

    // 2. Ticket (incremental, nessun limite)
    // Legge il timestamp dell'ultimo refresh dal KV se disponibile
    let startTime = 0;
    try {
      const { kv } = await import("@vercel/kv");
      const lastTs = await kv.get("last_refresh_ts");
      if (lastTs) startTime = parseInt(lastTs) - 600; // 10 min di margine
    } catch { /* KV non disponibile, scarica tutto */ }

    const allTickets = await fetchAllTicketsIncremental(startTime);
    console.log(`Tickets fetched: ${allTickets.length}`);

    // 3. Merge con ticket esistenti in KV (se aggiornamento incrementale)
    let ticketsMap = {};
    if (startTime > 0) {
      try {
        const { kv } = await import("@vercel/kv");
        const existing = await kv.get("tickets_map");
        if (existing) ticketsMap = existing;
      } catch { /* primo run */ }
    }
    for (const t of allTickets) {
      if (t.status === "deleted") delete ticketsMap[t.id];
      else ticketsMap[t.id] = t;
    }
    const tickets = Object.values(ticketsMap);

    // 4. Metriche ticket (batch da 100)
    const metricsMap = {};
    const ids = tickets.map(t => t.id);
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      try {
        const ticketsWithMetrics = await fetchMetricsBatch(batch);
        for (const t of ticketsWithMetrics) {
          metricsMap[t.id] = t.metric_set || {};
        }
      } catch (e) {
        console.warn(`Metrics batch error at ${i}:`, e.message);
      }
    }
    console.log(`Metrics: ${Object.keys(metricsMap).length}`);

    // 5. Calcola statistiche
    const stats = computeStats(agents, tickets, metricsMap);

    // 6. Salva su Vercel KV
    try {
      const { kv } = await import("@vercel/kv");
      await kv.set("dashboard_stats", stats);
      await kv.set("tickets_map", ticketsMap);
      await kv.set("last_refresh_ts", Math.floor(Date.now() / 1000).toString());
      console.log("Saved to KV");
    } catch (e) {
      console.warn("KV not available:", e.message);
      // In sviluppo locale: restituisce i dati direttamente
      return res.status(200).json({ ok: true, stats });
    }

    console.log("Refresh completed:", new Date().toISOString());
    res.status(200).json({
      ok: true,
      tickets: tickets.length,
      agents: agents.length,
      generated_at: stats.generated_at,
    });

  } catch (e) {
    console.error("Refresh error:", e);
    res.status(500).json({ error: e.message });
  }
}
