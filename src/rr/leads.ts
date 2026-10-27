/** Lead ingestion (forms via signed POST, calls via Twilio webhooks), spam + duplicate detection. */
import type { Context } from "hono";
import type { Env, RrSite } from "../types";
import { hmacB64, hmacHex, normPhone, resolveAlert, safeEqual } from "./common";

type C = Context<{ Bindings: Env }>;

const SPAM_WORDS = /\b(seo|backlinks?|guest post|crypto|bitcoin|casino|viagra|cialis|loan offer|web ?design services|rank (your|you) (site|website)|first page of google|marketing agency|outsourc|whatsapp me|telegram|forex|porn|sex)\b/i;
const DISPOSABLE = /@(mailinator|guerrillamail|10minutemail|tempmail|yopmail|trashmail|sharklasers|getnada|dispostable|maildrop)\./i;

export function spamCheck(lead: { name?: string; email?: string; phone?: string; message?: string; honeypot?: string; elapsed_ms?: number }, country: string) {
  const reasons: string[] = [];
  let score = 0;
  const msg = lead.message || "";
  if (lead.honeypot) { score += 5; reasons.push("honeypot filled"); }
  if (typeof lead.elapsed_ms === "number" && lead.elapsed_ms < 2500) { score += 3; reasons.push("submitted too fast"); }
  const links = (msg.match(/https?:\/\/|www\./gi) || []).length;
  if (links >= 2) { score += 3; reasons.push(`${links} links`); } else if (links === 1) { score += 1; reasons.push("contains a link"); }
  if (SPAM_WORDS.test(msg) || SPAM_WORDS.test(lead.name || "")) { score += 3; reasons.push("spam keywords"); }
  if (/[Ѐ-ӿ一-鿿฀-๿]/.test(msg + (lead.name || ""))) { score += 2; reasons.push("non-English script"); }
  if (lead.email && DISPOSABLE.test(lead.email)) { score += 2; reasons.push("disposable email"); }
  const phone = normPhone(lead.phone, country);
  const cc = country === "NZ" ? "+64" : "+61";
  if (lead.phone && !phone.startsWith(cc)) { score += 1; reasons.push("phone not " + country); }
  if (!lead.phone && !lead.email) { score += 2; reasons.push("no contact details"); }
  if (msg && msg.trim().length < 4) { score += 1; reasons.push("very short message"); }
  return { score, reasons, spam: score >= 4, phone };
}

async function findDuplicate(env: Env, siteId: number, phone: string, email: string) {
  if (!phone && !email) return null;
  return env.DB.prepare(
    `SELECT id FROM rr_leads WHERE site_id=? AND received_at > datetime('now','-30 days') AND status != 'spam'
     AND ((? != '' AND phone = ?) OR (? != '' AND lower(email) = lower(?))) ORDER BY id LIMIT 1`
  ).bind(siteId, phone, phone, email, email).first<{ id: number }>();
}

/**
 * POST /hooks/lead/:siteId
 * Headers: X-Timestamp (unix seconds), X-Signature = hex HMAC-SHA256(site.lead_secret, `${timestamp}.${rawBody}`)
 * Body JSON: { name, phone, email, message, page, utm, honeypot, elapsed_ms, test }
 */
export async function ingestLead(c: C) {
  const siteId = Number(c.req.param("siteId"));
  const raw = await c.req.text();
  const site = await c.env.DB.prepare(`SELECT * FROM rr_sites WHERE id=?`).bind(siteId).first<RrSite>();
  if (!site) return c.json({ error: "unknown site" }, 404);
  const ts = c.req.header("X-Timestamp") || "";
  const sig = (c.req.header("X-Signature") || "").toLowerCase();
  if (!ts || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return c.json({ error: "stale or missing timestamp" }, 401);
  if (!safeEqual(sig, await hmacHex(site.lead_secret, `${ts}.${raw}`))) return c.json({ error: "bad signature" }, 401);

  let body: any;
  try { body = JSON.parse(raw); } catch { return c.json({ error: "invalid JSON" }, 400); }

  // Synthetic weekly form test: mark the check as passed, don't store as a lead.
  if (body.test === true || c.req.header("X-Synthetic-Test") === "1") {
    await c.env.DB.prepare(
      `INSERT INTO rr_checks(site_id, kind, ok, fails, detail, checked_at, last_ok_at) VALUES (?, 'form', 1, 0, 'Test lead received', datetime('now'), datetime('now'))
       ON CONFLICT(site_id, kind) DO UPDATE SET ok=1, fails=0, detail='Test lead received', checked_at=datetime('now'), last_ok_at=datetime('now')`
    ).bind(siteId).run();
    await resolveAlert(c.env, `form:${siteId}`);
    return c.json({ ok: true, test: true });
  }

  const s = String;
  const lead = {
    name: s(body.name || "").slice(0, 120), email: s(body.email || "").slice(0, 160).trim(), phone: s(body.phone || "").slice(0, 40),
    message: s(body.message || "").slice(0, 4000), honeypot: body.honeypot ? s(body.honeypot) : "", elapsed_ms: typeof body.elapsed_ms === "number" ? body.elapsed_ms : undefined,
  };
  const spam = spamCheck(lead, site.country);
  const dup = spam.spam ? null : await findDuplicate(c.env, siteId, spam.phone, lead.email);
  const status = spam.spam ? "spam" : dup ? "duplicate" : "new";
  const r = await c.env.DB.prepare(
    `INSERT INTO rr_leads(site_id, kind, name, phone, email, message, page, utm, status, spam_score, spam_reasons, duplicate_of)
     VALUES (?, 'form', ?,?,?,?,?,?,?,?,?,?) RETURNING id`
  ).bind(siteId, lead.name, spam.phone || lead.phone, lead.email, lead.message, s(body.page || "").slice(0, 300),
    body.utm ? JSON.stringify(body.utm).slice(0, 1000) : null, status, spam.score, spam.reasons.join(", "), dup?.id ?? null).first<{ id: number }>();
  return c.json({ ok: true, id: r!.id, status });
}

// ---------------- Twilio ----------------

/** Validate X-Twilio-Signature: base64(HMAC-SHA1(authToken, url + sorted(key+value)…)). */
async function verifyTwilio(c: C, params: Record<string, string>) {
  if (!c.env.TWILIO_AUTH_TOKEN) return false;
  const url = c.req.url;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = await hmacB64(c.env.TWILIO_AUTH_TOKEN, data, "SHA-1");
  return safeEqual(expected, c.req.header("X-Twilio-Signature") || "");
}

async function formParams(c: C) {
  const form = await c.req.parseBody();
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(form)) out[k] = String(v);
  return out;
}

async function siteByNumber(env: Env, to: string) {
  return env.DB.prepare(`SELECT * FROM rr_sites WHERE twilio_number=?`).bind(normPhone(to)).first<RrSite>();
}

const twiml = (c: C, body: string) => c.body(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, 200, { "Content-Type": "text/xml" });
const xmlEsc = (s: string) => s.replace(/[<>&"']/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[ch]!));

/**
 * POST /hooks/twilio/voice — set as the number's "A call comes in" webhook.
 * Logs the call and forwards it to the site's forward_to number, recording it.
 */
export async function twilioVoice(c: C) {
  const p = await formParams(c);
  if (!(await verifyTwilio(c, p))) return c.text("forbidden", 403);
  const site = await siteByNumber(c.env, p.To);
  if (!site) return twiml(c, `<Say>Sorry, this number is not in service.</Say><Hangup/>`);
  await upsertCall(c.env, site, p.CallSid, p.From, p.To, "ringing");
  if (!site.forward_to) return twiml(c, `<Say>Sorry, no one is available. Please try again later.</Say><Hangup/>`);
  const base = new URL(c.req.url).origin;
  return twiml(c,
    `<Dial timeout="25" record="record-from-answer-dual" action="${base}/hooks/twilio/dial" recordingStatusCallback="${base}/hooks/twilio/recording" callerId="${xmlEsc(p.From || "")}">` +
    `<Number>${xmlEsc(site.forward_to)}</Number></Dial>`);
}

/** POST /hooks/twilio/dial — <Dial action>: final outcome of the forwarded call. */
export async function twilioDial(c: C) {
  const p = await formParams(c);
  if (!(await verifyTwilio(c, p))) return c.text("forbidden", 403);
  const site = await siteByNumber(c.env, p.To);
  if (site) {
    const answered = p.DialCallStatus === "completed" ? 1 : 0;
    const duration = Number(p.DialCallDuration || 0);
    await upsertCall(c.env, site, p.CallSid, p.From, p.To, p.DialCallStatus || p.CallStatus, { answered, duration });
    await callToLead(c.env, site, p.CallSid);
  }
  return twiml(c, p.DialCallStatus === "completed" ? `<Hangup/>` : `<Say>Sorry we missed your call. We will call you back shortly.</Say><Hangup/>`);
}

/**
 * POST /hooks/twilio/status — optional "Call status changes" webhook, for numbers that
 * forward elsewhere (your own TwiML / Studio). Logs the call; answered = completed with duration.
 */
export async function twilioStatus(c: C) {
  const p = await formParams(c);
  if (!(await verifyTwilio(c, p))) return c.text("forbidden", 403);
  const site = await siteByNumber(c.env, p.To);
  if (site && ["completed", "busy", "no-answer", "failed", "canceled"].includes(p.CallStatus)) {
    const existing = await c.env.DB.prepare(`SELECT status FROM rr_calls WHERE call_sid=?`).bind(p.CallSid).first<{ status: string }>();
    // don't overwrite the more precise DialCallStatus
    if (!existing || existing.status === "ringing") {
      const duration = Number(p.CallDuration || 0);
      await upsertCall(c.env, site, p.CallSid, p.From, p.To, p.CallStatus, { answered: p.CallStatus === "completed" && duration > 15 ? 1 : 0, duration });
      await callToLead(c.env, site, p.CallSid);
    }
  }
  return c.text("ok");
}

/** POST /hooks/twilio/recording — recordingStatusCallback. */
export async function twilioRecording(c: C) {
  const p = await formParams(c);
  if (!(await verifyTwilio(c, p))) return c.text("forbidden", 403);
  if (p.RecordingStatus === "completed" && p.CallSid) {
    // For <Dial record>, CallSid here is the inbound (parent) call we logged.
    await c.env.DB.prepare(`UPDATE rr_calls SET recording_url=? WHERE call_sid=?`).bind(p.RecordingUrl + ".mp3", p.CallSid).run();
  }
  return c.text("ok");
}

async function upsertCall(env: Env, site: RrSite, sid: string, from: string, to: string, status: string, extra?: { answered: number; duration: number }) {
  const fromN = normPhone(from, site.country);
  const seen = await env.DB.prepare(`SELECT 1 FROM rr_calls WHERE site_id=? AND from_number=? AND call_sid != ? LIMIT 1`).bind(site.id, fromN, sid).first();
  await env.DB.prepare(
    `INSERT INTO rr_calls(site_id, call_sid, from_number, to_number, status, answered, duration, first_time) VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(call_sid) DO UPDATE SET status=excluded.status,
       answered=CASE WHEN ? IS NULL THEN answered ELSE excluded.answered END,
       duration=CASE WHEN ? IS NULL THEN duration ELSE excluded.duration END`
  ).bind(site.id, sid, fromN, normPhone(to), status, extra?.answered ?? 0, extra?.duration ?? 0, seen ? 0 : 1, extra ? 1 : null, extra ? 1 : null).run();
}

/** Every finished call also becomes a lead row (kind=call); repeat callers in 30 days are duplicates. */
async function callToLead(env: Env, site: RrSite, sid: string) {
  const exists = await env.DB.prepare(`SELECT id FROM rr_leads WHERE call_sid=?`).bind(sid).first();
  if (exists) return;
  const call = await env.DB.prepare(`SELECT * FROM rr_calls WHERE call_sid=?`).bind(sid).first<any>();
  if (!call) return;
  const dup = await findDuplicate(env, site.id, call.from_number, "");
  await env.DB.prepare(
    `INSERT INTO rr_leads(site_id, kind, phone, message, status, call_sid, duplicate_of) VALUES (?, 'call', ?, ?, ?, ?, ?)`
  ).bind(site.id, call.from_number, call.answered ? `Answered call, ${call.duration}s` : `Missed call (${call.status})`, dup ? "duplicate" : "new", sid, dup?.id ?? null).run();
}

/** Snippet for an Astro site's contact Worker. */
export function leadSnippet(origin: string, site: RrSite) {
  return `// In the site's contact Worker, after saving the lead to the site's own D1:
// (store LEAD_SECRET as a Worker secret on that site: ${site.lead_secret.slice(0, 6)}… — copy the full value from the platform)
async function forwardLead(env, lead) {
  const body = JSON.stringify(lead); // { name, phone, email, message, page, utm, honeypot, elapsed_ms }
  const ts = Math.floor(Date.now() / 1000).toString();
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.LEAD_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ts + "." + body)))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  await fetch("${origin}/hooks/lead/${site.id}", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Timestamp": ts, "X-Signature": sig },
    body,
  });
}
// ctx.waitUntil(forwardLead(env, lead)); — keep it non-blocking.
// Weekly test: the platform POSTs {"test":true,...} with header X-Synthetic-Test: 1 to your form endpoint.
// Pass that flag through (lead.test = true) and skip emailing the tenant for test leads.`;
}
