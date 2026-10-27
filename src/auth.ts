import type { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Env } from "./types";

const COOKIE = "seo_session";
const enc = new TextEncoder();

async function hmac(secret: string, msg: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function login(c: Context<{ Bindings: Env }>) {
  const { password } = await c.req.json<{ password: string }>().catch(() => ({ password: "" }));
  if (!c.env.ADMIN_PASSWORD || !c.env.SESSION_SECRET) return c.json({ error: "ADMIN_PASSWORD / SESSION_SECRET secrets are not set." }, 500);
  // compare HMACs so timing doesn't leak the password length
  const ok = safeEqual(await hmac(c.env.SESSION_SECRET, password || ""), await hmac(c.env.SESSION_SECRET, c.env.ADMIN_PASSWORD));
  if (!ok) {
    await new Promise((r) => setTimeout(r, 800));
    return c.json({ error: "Wrong password." }, 401);
  }
  const exp = Date.now() + 30 * 24 * 3600 * 1000;
  const token = `${exp}.${await hmac(c.env.SESSION_SECRET, String(exp))}`;
  setCookie(c, COOKIE, token, { httpOnly: true, secure: new URL(c.req.url).protocol === "https:", sameSite: "Lax", path: "/", maxAge: 30 * 24 * 3600 });
  return c.json({ ok: true });
}

export function logout(c: Context) {
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
}

export async function requireAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const token = getCookie(c, COOKIE) || "";
  const [exp, sig] = token.split(".");
  if (exp && sig && Number(exp) > Date.now() && c.env.SESSION_SECRET && safeEqual(sig, await hmac(c.env.SESSION_SECRET, exp))) {
    return next();
  }
  return c.json({ error: "unauthorized" }, 401);
}
