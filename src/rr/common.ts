import type { Env } from "../types";
import { CITIES } from "./cities";

export const DEFAULT_SETTINGS: Record<string, string> = {
  rank_drop_threshold: "5",       // alert when a money keyword drops more than X positions
  lead_drop_pct: "50",            // alert when last-7-day leads < X% of the 4-week weekly average
  lead_drop_min_avg: "3",         // ...only when the 4-week weekly average is at least this
  twilio_low_balance: "20",       // USD
  sms_spike_factor: "3",          // today's SMS/calls > factor × 7-day avg
  sms_spike_min: "30",            // ...and above this absolute count
  retention_months: "12",         // auto-delete leads/calls older than this
  digest_hour_utc: "0",           // daily digest hour (0 UTC = 7:00 in Vietnam)
  domain_expiry_days: "30",       // warn this many days before domain expiry
  critical_telegram_now: "1",     // send critical alerts (site down, SMS pumping) immediately
};

export async function getSettings(env: Env): Promise<Record<string, string>> {
  const { results } = await env.DB.prepare(`SELECT key, value FROM rr_settings`).all<{ key: string; value: string }>();
  const s = { ...DEFAULT_SETTINGS };
  for (const r of results) s[r.key] = r.value;
  return s;
}

export async function ensureCities(env: Env) {
  const row = await env.DB.prepare(`SELECT COUNT(*) n FROM cities`).first<{ n: number }>();
  if (row && row.n > 0) return;
  await env.DB.batch(
    CITIES.map(([name, region, country, pop, lat, lng, regional]) =>
      env.DB.prepare(`INSERT OR IGNORE INTO cities(name, region, country, population, lat, lng, regional) VALUES (?,?,?,?,?,?,?)`)
        .bind(name, region, country, pop, lat, lng, regional)
    )
  );
}

export function randomSecret(bytes = 24) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const enc = new TextEncoder();
export async function hmacHex(secret: string, msg: string, hash: "SHA-256" | "SHA-1" = "SHA-256") {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function hmacB64(secret: string, msg: string, hash: "SHA-256" | "SHA-1" = "SHA-1") {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
  return btoa(String.fromCharCode(...sig));
}
export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Normalise AU/NZ phone numbers to E.164 where possible. */
export function normPhone(raw: string | null | undefined, country = "AU"): string {
  if (!raw) return "";
  let d = String(raw).replace(/[^\d+]/g, "");
  if (d.startsWith("00")) d = "+" + d.slice(2);
  if (d.startsWith("+")) return d;
  const cc = country === "NZ" ? "64" : "61";
  if (d.startsWith(cc) && d.length >= 10) return "+" + d;
  if (d.startsWith("0")) return "+" + cc + d.slice(1);
  return d;
}

/** Raise an alert unless an open one with the same key exists. Returns true when new. */
export async function raiseAlert(env: Env, a: { site_id: number | null; kind: string; severity?: string; message: string; key: string }) {
  const open = await env.DB.prepare(`SELECT id FROM rr_alerts WHERE dedupe_key=? AND resolved_at IS NULL`).bind(a.key).first();
  if (open) return false;
  await env.DB.prepare(`INSERT INTO rr_alerts(site_id, kind, severity, message, dedupe_key) VALUES (?,?,?,?,?)`)
    .bind(a.site_id, a.kind, a.severity || "warn", a.message, a.key).run();
  if (a.severity === "critical") {
    const s = await getSettings(env);
    if (s.critical_telegram_now === "1" && env.TELEGRAM_BOT_TOKEN) {
      await sendTelegram(env, `🚨 ${a.message}`).catch((e) => console.error("telegram", e));
    }
  }
  return true;
}

export async function resolveAlert(env: Env, key: string) {
  await env.DB.prepare(`UPDATE rr_alerts SET resolved_at=datetime('now') WHERE dedupe_key=? AND resolved_at IS NULL`).bind(key).run();
}

export async function sendTelegram(env: Env, text: string) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return false;
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: text.slice(0, 4000), disable_web_page_preview: true }),
  });
  if (!r.ok) throw new Error(`Telegram ${r.status}`);
  return true;
}

export async function sendEmail(env: Env, subject: string, html: string) {
  if (!env.RESEND_API_KEY || !env.ALERT_EMAIL_TO) return false;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.ALERT_EMAIL_FROM || "Duy SEO <alerts@resend.dev>", to: env.ALERT_EMAIL_TO.split(","), subject, html }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
  return true;
}

export const escHtml = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
