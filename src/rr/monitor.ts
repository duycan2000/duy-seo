/** R&R monitoring: uptime, SSL, domain expiry, synthetic form test, Twilio, lead drops, rent due, retention, digest. */
import type { Env, RrSite } from "../types";
import { mapLimit } from "../util";
import { escHtml, getSettings, raiseAlert, resolveAlert, sendEmail, sendTelegram } from "./common";

const LIVE = `status IN ('ranking','trial','rented','for_sale')`;

async function setCheck(env: Env, siteId: number, kind: string, ok: boolean, detail: string) {
  await env.DB.prepare(
    `INSERT INTO rr_checks(site_id, kind, ok, fails, detail, checked_at, last_ok_at) VALUES (?,?,?,?,?,datetime('now'), CASE WHEN ? THEN datetime('now') END)
     ON CONFLICT(site_id, kind) DO UPDATE SET ok=excluded.ok, fails=CASE WHEN excluded.ok THEN 0 ELSE fails+1 END,
       detail=excluded.detail, checked_at=excluded.checked_at, last_ok_at=COALESCE(excluded.last_ok_at, last_ok_at)`
  ).bind(siteId, kind, ok ? 1 : 0, ok ? 0 : 1, detail.slice(0, 300), ok ? 1 : 0).run();
  return env.DB.prepare(`SELECT fails FROM rr_checks WHERE site_id=? AND kind=?`).bind(siteId, kind).first<{ fails: number }>();
}

/** Every 15 min. Two consecutive failures = site down (critical). TLS errors flag SSL. */
export async function uptimeChecks(env: Env) {
  const sites = (await env.DB.prepare(`SELECT * FROM rr_sites WHERE ${LIVE} OR status='building'`).all<RrSite>()).results;
  await mapLimit(sites, 10, async (site) => {
    const url = site.uptime_url || `https://${site.domain}/`;
    const t0 = Date.now();
    let ok = false, detail = "", tls = false;
    try {
      const r = await fetch(url, { redirect: "follow", headers: { "User-Agent": "DuySEO-Uptime/1.0" }, signal: AbortSignal.timeout(15000) });
      ok = r.status < 500;
      detail = `HTTP ${r.status} in ${Date.now() - t0} ms`;
    } catch (e: any) {
      detail = e.message || "fetch failed";
      tls = /ssl|tls|certificate|handshake/i.test(detail);
    }
    if (site.status === "building") return; // record nothing for unfinished sites
    const res = await setCheck(env, site.id, "uptime", ok, detail);
    if (!ok && (res?.fails || 0) >= 2) {
      await raiseAlert(env, { site_id: site.id, kind: "down", severity: "critical", key: `down:${site.id}`, message: `${site.domain} is DOWN — ${detail}` });
    } else if (ok) {
      await resolveAlert(env, `down:${site.id}`);
    }
    await setCheck(env, site.id, "ssl", !tls, tls ? detail : "HTTPS OK");
    if (tls) await raiseAlert(env, { site_id: site.id, kind: "ssl", severity: "critical", key: `ssl:${site.id}`, message: `${site.domain}: HTTPS/SSL error — ${detail}` });
    else if (ok) await resolveAlert(env, `ssl:${site.id}`);
  });
}

/** Daily: domain expiry via RDAP (falls back to the manual date on the site). */
export async function domainExpiry(env: Env) {
  const s = await getSettings(env);
  const warnDays = Number(s.domain_expiry_days) || 30;
  const sites = (await env.DB.prepare(`SELECT * FROM rr_sites WHERE status != 'sold'`).all<RrSite>()).results;
  for (const site of sites) {
    let expiry = site.domain_expiry;
    try {
      const r = await fetch(`https://rdap.org/domain/${site.domain}`, { headers: { Accept: "application/rdap+json" }, signal: AbortSignal.timeout(10000) });
      if (r.ok) {
        const j: any = await r.json();
        const ev = (j.events || []).find((e: any) => e.eventAction === "expiration");
        if (ev?.eventDate) {
          expiry = String(ev.eventDate).slice(0, 10);
          await env.DB.prepare(`UPDATE rr_sites SET domain_expiry=? WHERE id=?`).bind(expiry, site.id).run();
        }
      }
    } catch { /* many ccTLDs (.au) don't publish expiry via RDAP — keep the manual date */ }
    if (!expiry) continue;
    const days = Math.round((Date.parse(expiry) - Date.now()) / 864e5);
    await setCheck(env, site.id, "domain", days > warnDays, `Expires ${expiry} (${days} days)`);
    if (days <= warnDays) await raiseAlert(env, { site_id: site.id, kind: "domain", severity: days <= 7 ? "critical" : "warn", key: `domain:${site.id}:${expiry}`, message: `${site.domain}: domain expires ${expiry} (${days} days)` });
  }
}

/** Weekly: POST a synthetic lead to each site's form endpoint; the site must forward it back with test=true. */
export async function formTests(env: Env) {
  const sites = (await env.DB.prepare(`SELECT * FROM rr_sites WHERE ${LIVE} AND form_test_url != ''`).all<RrSite>()).results;
  for (const site of sites) {
    let detail = "";
    try {
      const r = await fetch(site.form_test_url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Synthetic-Test": "1" },
        body: JSON.stringify({ name: "Synthetic Test", phone: "0400000000", email: "test@example.com", message: "Automated weekly form test — please ignore.", test: true, elapsed_ms: 9999 }),
        signal: AbortSignal.timeout(20000),
      });
      detail = `Form endpoint HTTP ${r.status}; waiting for test lead`;
      if (!r.ok) {
        await setCheck(env, site.id, "form", false, detail);
        await raiseAlert(env, { site_id: site.id, kind: "form", severity: "warn", key: `form:${site.id}`, message: `${site.domain}: form test failed (HTTP ${r.status})` });
        continue;
      }
    } catch (e: any) {
      await setCheck(env, site.id, "form", false, e.message);
      await raiseAlert(env, { site_id: site.id, kind: "form", severity: "warn", key: `form:${site.id}`, message: `${site.domain}: form test failed — ${e.message}` });
      continue;
    }
    // Pending until the platform receives the test lead (see ingestLead). Mark not-ok with a pending marker.
    await env.DB.prepare(
      `INSERT INTO rr_checks(site_id, kind, ok, fails, detail, checked_at) VALUES (?, 'form', NULL, 0, ?, datetime('now'))
       ON CONFLICT(site_id, kind) DO UPDATE SET ok=NULL, detail=excluded.detail, checked_at=excluded.checked_at`
    ).bind(site.id, detail).run();
  }
}

/** Every 15 min: test leads that never arrived within 30 minutes. */
export async function formTestTimeouts(env: Env) {
  const stuck = (await env.DB.prepare(
    `SELECT c.site_id, s.domain FROM rr_checks c JOIN rr_sites s ON s.id=c.site_id WHERE c.kind='form' AND c.ok IS NULL AND c.checked_at < datetime('now','-30 minutes')`
  ).all<{ site_id: number; domain: string }>()).results;
  for (const r of stuck) {
    await env.DB.prepare(`UPDATE rr_checks SET ok=0, fails=fails+1, detail='Form accepted the test but no lead reached the platform within 30 min' WHERE site_id=? AND kind='form'`).bind(r.site_id).run();
    await raiseAlert(env, { site_id: r.site_id, kind: "form", severity: "warn", key: `form:${r.site_id}`, message: `${r.domain}: form test lead never arrived — lead forwarding may be broken` });
  }
}

async function twilioGet(env: Env, path: string) {
  const base = env.TWILIO_API_BASE || "https://api.twilio.com";
  const r = await fetch(`${base}/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/${path}`, {
    headers: { Authorization: "Basic " + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`) },
  });
  if (!r.ok) throw new Error(`Twilio ${r.status}`);
  return r.json<any>();
}

/** Hourly: Twilio balance + SMS/call spikes (SMS pumping / toll fraud). */
export async function twilioChecks(env: Env) {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) return;
  const s = await getSettings(env);
  try {
    const bal = await twilioGet(env, "Balance.json");
    const balance = Number(bal.balance);
    if (balance < Number(s.twilio_low_balance)) {
      await raiseAlert(env, { site_id: null, kind: "twilio_balance", severity: "warn", key: "twilio_balance", message: `Twilio balance is low: ${bal.currency || "USD"} ${balance.toFixed(2)}` });
    } else await resolveAlert(env, "twilio_balance");
    await env.DB.prepare(`INSERT OR REPLACE INTO rr_settings(key, value) VALUES ('twilio_last_balance', ?)`).bind(`${balance.toFixed(2)} ${bal.currency || "USD"}`).run();
  } catch (e: any) { console.error("twilio balance", e.message); }

  const start = new Date(Date.now() - 8 * 864e5).toISOString().slice(0, 10);
  for (const cat of ["sms", "calls"]) {
    try {
      const d = await twilioGet(env, `Usage/Records/Daily.json?Category=${cat}&StartDate=${start}&PageSize=20`);
      const recs = (d.usage_records || []).map((r: any) => ({ day: r.start_date, count: Number(r.count || 0) })).sort((a: any, b: any) => a.day.localeCompare(b.day));
      if (recs.length < 2) continue;
      const today = recs[recs.length - 1];
      const prior = recs.slice(0, -1).slice(-7);
      const avg = prior.reduce((a: number, r: any) => a + r.count, 0) / prior.length;
      const factor = Number(s.sms_spike_factor) || 3;
      if (today.count > Math.max(avg * factor, Number(s.sms_spike_min) || 30)) {
        await raiseAlert(env, { site_id: null, kind: "spike", severity: "critical", key: `spike:${cat}:${today.day}`,
          message: `Twilio ${cat} spike: ${today.count} today vs ${avg.toFixed(0)}/day average — check for SMS pumping / toll fraud` });
      }
    } catch (e: any) { console.error("twilio usage", e.message); }
  }
}

/** Daily: lead volume drop vs 4-week average; rent overdue (until Billing ships). */
export async function leadAndRentChecks(env: Env) {
  const s = await getSettings(env);
  const sites = (await env.DB.prepare(`SELECT * FROM rr_sites WHERE ${LIVE}`).all<RrSite>()).results;
  for (const site of sites) {
    const r = await env.DB.prepare(
      `SELECT SUM(CASE WHEN received_at > datetime('now','-7 days') THEN 1 ELSE 0 END) last7,
              SUM(CASE WHEN received_at <= datetime('now','-7 days') THEN 1 ELSE 0 END) prior28
       FROM rr_leads WHERE site_id=? AND status IN ('new','sent','qualified') AND received_at > datetime('now','-35 days')`
    ).bind(site.id).first<{ last7: number; prior28: number }>();
    const weeklyAvg = (r?.prior28 || 0) / 4;
    const last7 = r?.last7 || 0;
    const key = `leaddrop:${site.id}`;
    if (weeklyAvg >= Number(s.lead_drop_min_avg) && last7 < weeklyAvg * (Number(s.lead_drop_pct) / 100)) {
      await raiseAlert(env, { site_id: site.id, kind: "lead_drop", severity: "warn", key, message: `${site.domain}: ${last7} leads in the last 7 days vs ${weeklyAvg.toFixed(1)}/week average` });
    } else if (last7 >= weeklyAvg * 0.8) await resolveAlert(env, key);

    if (site.status === "rented" && site.rent_paid_until && site.rent_paid_until < new Date().toISOString().slice(0, 10)) {
      await raiseAlert(env, { site_id: site.id, kind: "unpaid", severity: "warn", key: `unpaid:${site.id}:${site.rent_paid_until}`,
        message: `${site.domain}: rent from ${site.tenant_name || "tenant"} unpaid since ${site.rent_paid_until}` });
    }
  }
}

/** Daily: delete lead PII older than the retention window (AU/NZ Privacy Acts). */
export async function retention(env: Env) {
  const s = await getSettings(env);
  const months = Math.max(1, Number(s.retention_months) || 12);
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM rr_leads WHERE received_at < datetime('now', ?)`).bind(`-${months} months`),
    env.DB.prepare(`DELETE FROM rr_calls WHERE started_at < datetime('now', ?)`).bind(`-${months} months`),
    env.DB.prepare(`DELETE FROM rr_alerts WHERE created_at < datetime('now','-180 days')`),
  ]);
}

/** Daily digest of unsent alerts + yesterday's numbers, via email and/or Telegram. */
export async function sendDigest(env: Env, force = false) {
  const alerts = (await env.DB.prepare(
    `SELECT a.*, s.domain FROM rr_alerts a LEFT JOIN rr_sites s ON s.id=a.site_id WHERE a.sent_at IS NULL ORDER BY CASE a.severity WHEN 'critical' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END, a.created_at`
  ).all<any>()).results;
  const leads = (await env.DB.prepare(
    `SELECT s.domain, SUM(CASE WHEN l.kind='form' THEN 1 ELSE 0 END) forms, SUM(CASE WHEN l.kind='call' THEN 1 ELSE 0 END) calls
     FROM rr_leads l JOIN rr_sites s ON s.id=l.site_id WHERE l.received_at > datetime('now','-1 day') AND l.status IN ('new','sent','qualified')
     GROUP BY s.domain ORDER BY forms+calls DESC`
  ).all<any>()).results;
  if (!alerts.length && !leads.length && !force) return { sent: false, reason: "nothing to report" };

  const icon = (sev: string) => (sev === "critical" ? "🔴" : sev === "warn" ? "🟠" : "🔵");
  const total = leads.reduce((s, r) => s + r.forms + r.calls, 0);
  const text = [
    `Duy SEO — R&R daily digest`,
    `Leads in the last 24h: ${total}` + (leads.length ? "\n" + leads.map((r) => `• ${r.domain}: ${r.forms} forms, ${r.calls} calls`).join("\n") : ""),
    alerts.length ? `Alerts (${alerts.length}):\n` + alerts.map((a) => `${icon(a.severity)} ${a.message}`).join("\n") : "No new alerts.",
  ].join("\n\n");
  const html = `<h2>R&amp;R daily digest</h2><p><b>${total}</b> leads in the last 24 hours.</p>` +
    (leads.length ? `<ul>${leads.map((r) => `<li>${escHtml(r.domain)}: ${r.forms} forms, ${r.calls} calls</li>`).join("")}</ul>` : "") +
    (alerts.length ? `<h3>Alerts</h3><ul>${alerts.map((a) => `<li>${icon(a.severity)} ${escHtml(a.message)}</li>`).join("")}</ul>` : "<p>No new alerts.</p>");

  const results: string[] = [];
  try { if (await sendEmail(env, alerts.some((a) => a.severity === "critical") ? "🔴 R&R digest — action needed" : "R&R daily digest", html)) results.push("email"); } catch (e: any) { results.push("email failed: " + e.message); }
  try { if (await sendTelegram(env, text)) results.push("telegram"); } catch (e: any) { results.push("telegram failed: " + e.message); }
  const delivered = results.some((r) => r === "email" || r === "telegram");
  if (delivered && alerts.length) await env.DB.prepare(`UPDATE rr_alerts SET sent_at=datetime('now') WHERE id IN (${alerts.map((a) => a.id).join(",")})`).run();
  return { sent: delivered, channels: results, alerts: alerts.length, leads: total };
}
