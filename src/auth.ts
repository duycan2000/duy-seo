import type { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Env } from "./types";

const COOKIE = "seo_session";
const enc = new TextEncoder();
export const ROLES = ["admin", "member", "viewer"] as const;
export type Role = "owner" | (typeof ROLES)[number];
export interface SessionUser { id: number; email: string; name: string; role: Role }

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

const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** PBKDF2-SHA256, 100k iterations (Workers' maximum). Returns hex hash. */
export async function hashPassword(password: string, saltHex: string) {
  const salt = Uint8Array.from(saltHex.match(/../g)!.map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256);
  return hex(bits);
}
export function newSalt() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return hex(a);
}

async function issue(c: Context<{ Bindings: Env }>, uid: number) {
  const exp = Date.now() + 30 * 24 * 3600 * 1000;
  const payload = `${exp}.${uid}`;
  const token = `${payload}.${await hmac(c.env.SESSION_SECRET, payload)}`;
  setCookie(c, COOKIE, token, { httpOnly: true, secure: new URL(c.req.url).protocol === "https:", sameSite: "Lax", path: "/", maxAge: 30 * 24 * 3600 });
}

const fail = async (c: Context, msg: string) => {
  await new Promise((r) => setTimeout(r, 800));
  return c.json({ error: msg }, 401);
};

/** Owner logs in with ADMIN_PASSWORD (email empty); everyone else with email + own password. */
export async function login(c: Context<{ Bindings: Env }>) {
  const { email, password } = await c.req.json<{ email?: string; password: string }>().catch(() => ({ email: "", password: "" }));
  if (!c.env.ADMIN_PASSWORD || !c.env.SESSION_SECRET) return c.json({ error: "ADMIN_PASSWORD / SESSION_SECRET secrets are not set." }, 500);
  const mail = String(email || "").trim().toLowerCase();
  if (!mail || mail === "owner") {
    // compare HMACs so timing doesn't leak the password length
    const ok = safeEqual(await hmac(c.env.SESSION_SECRET, password || ""), await hmac(c.env.SESSION_SECRET, c.env.ADMIN_PASSWORD));
    if (!ok) return fail(c, "Wrong password.");
    await issue(c, 0);
    return c.json({ ok: true });
  }
  const u = await c.env.DB.prepare(`SELECT * FROM users WHERE email=?`).bind(mail).first<any>().catch(() => null);
  if (!u || u.disabled) return fail(c, "Wrong email or password.");
  if (!safeEqual(await hashPassword(password || "", u.pass_salt), u.pass_hash)) return fail(c, "Wrong email or password.");
  await c.env.DB.prepare(`UPDATE users SET last_login_at=datetime('now') WHERE id=?`).bind(u.id).run();
  await issue(c, u.id);
  return c.json({ ok: true });
}

export function logout(c: Context) {
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
}

/** Verifies the session cookie, loads the user (role read fresh from D1 so changes apply at once), enforces viewer = read-only. */
export async function requireAuth(c: Context<{ Bindings: Env; Variables: { user: SessionUser } }>, next: Next) {
  const token = getCookie(c, COOKIE) || "";
  const parts = token.split(".");
  // legacy 2-part tokens (exp.sig) from before multi-user = owner
  const [exp, uid, sig] = parts.length === 2 ? [parts[0], "0", parts[1]] : parts;
  const payload = parts.length === 2 ? exp : `${exp}.${uid}`;
  if (!(exp && sig && Number(exp) > Date.now() && c.env.SESSION_SECRET && safeEqual(sig, await hmac(c.env.SESSION_SECRET, payload)))) {
    return c.json({ error: "unauthorized" }, 401);
  }
  let user: SessionUser;
  if (uid === "0") user = { id: 0, email: "owner", name: "Owner", role: "owner" };
  else {
    const u = await c.env.DB.prepare(`SELECT id, email, name, role, disabled FROM users WHERE id=?`).bind(Number(uid)).first<any>();
    if (!u || u.disabled) return c.json({ error: "unauthorized" }, 401);
    user = { id: u.id, email: u.email, name: u.name, role: u.role };
  }
  c.set("user", user);
  const path = new URL(c.req.url).pathname;
  if (user.role === "viewer" && c.req.method !== "GET" && !["/api/logout", "/api/me/password"].includes(path)) {
    return c.json({ error: "Your account is view-only." }, 403);
  }
  return next();
}

export const canManageUsers = (u: SessionUser) => u.role === "owner" || u.role === "admin";
