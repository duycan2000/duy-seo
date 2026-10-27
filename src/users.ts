/** /api/users — team accounts (owner/admin only) and /api/me/password for everyone. */
import { Hono } from "hono";
import type { Env } from "./types";
import { canManageUsers, hashPassword, newSalt, ROLES, type SessionUser } from "./auth";

type C = { Bindings: Env; Variables: { user: SessionUser } };
const users = new Hono<C>();

const cleanEmail = (e: unknown) => String(e || "").trim().toLowerCase();
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

users.use("*", async (c, next) => {
  if (!canManageUsers(c.get("user"))) return c.json({ error: "Only admins can manage users." }, 403);
  return next();
});

users.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT id, email, name, role, disabled, created_at, last_login_at FROM users ORDER BY created_at`).all<any>();
  return c.json(results);
});

users.post("/", async (c) => {
  const b = await c.req.json<any>();
  const email = cleanEmail(b.email);
  if (!validEmail(email)) return c.json({ error: "Enter a valid email." }, 400);
  if (!ROLES.includes(b.role)) return c.json({ error: "Pick a role." }, 400);
  if (String(b.password || "").length < 8) return c.json({ error: "Password must be at least 8 characters." }, 400);
  // only the owner can create admins
  if (b.role === "admin" && c.get("user").role !== "owner") return c.json({ error: "Only the owner can create admins." }, 403);
  const exists = await c.env.DB.prepare(`SELECT 1 FROM users WHERE email=?`).bind(email).first();
  if (exists) return c.json({ error: "A user with this email already exists." }, 400);
  const salt = newSalt();
  await c.env.DB.prepare(`INSERT INTO users(email, name, role, pass_hash, pass_salt) VALUES (?,?,?,?,?)`)
    .bind(email, String(b.name || email.split("@")[0]).slice(0, 80), b.role, await hashPassword(String(b.password), salt), salt).run();
  return c.json({ ok: true });
});

users.put("/:id", async (c) => {
  const b = await c.req.json<any>();
  const id = Number(c.req.param("id"));
  const target = await c.env.DB.prepare(`SELECT role FROM users WHERE id=?`).bind(id).first<{ role: string }>();
  if (!target) return c.json({ error: "User not found." }, 404);
  const me = c.get("user");
  if (me.role !== "owner" && (target.role === "admin" || b.role === "admin")) return c.json({ error: "Only the owner can change admins." }, 403);
  const sets: string[] = [], args: unknown[] = [];
  if (b.name !== undefined) { sets.push("name=?"); args.push(String(b.name).slice(0, 80)); }
  if (b.role !== undefined) { if (!ROLES.includes(b.role)) return c.json({ error: "Invalid role." }, 400); sets.push("role=?"); args.push(b.role); }
  if (b.disabled !== undefined) { sets.push("disabled=?"); args.push(b.disabled ? 1 : 0); }
  if (b.password) {
    if (String(b.password).length < 8) return c.json({ error: "Password must be at least 8 characters." }, 400);
    const salt = newSalt();
    sets.push("pass_hash=?", "pass_salt=?");
    args.push(await hashPassword(String(b.password), salt), salt);
  }
  if (sets.length) await c.env.DB.prepare(`UPDATE users SET ${sets.join(",")} WHERE id=?`).bind(...args, id).run();
  return c.json({ ok: true });
});

users.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const target = await c.env.DB.prepare(`SELECT role FROM users WHERE id=?`).bind(id).first<{ role: string }>();
  if (target?.role === "admin" && c.get("user").role !== "owner") return c.json({ error: "Only the owner can remove admins." }, 403);
  await c.env.DB.prepare(`DELETE FROM users WHERE id=?`).bind(id).run();
  return c.json({ ok: true });
});

/** Any signed-in user (not the owner, who uses ADMIN_PASSWORD) can change their own password. */
export async function changeOwnPassword(c: any) {
  const me: SessionUser = c.get("user");
  if (me.id === 0) return c.json({ error: "The owner password is the ADMIN_PASSWORD secret — change it in Cloudflare." }, 400);
  const { current, next } = await c.req.json();
  const u = await c.env.DB.prepare(`SELECT pass_hash, pass_salt FROM users WHERE id=?`).bind(me.id).first();
  if (!u || (await hashPassword(String(current || ""), u.pass_salt)) !== u.pass_hash) return c.json({ error: "Current password is wrong." }, 400);
  if (String(next || "").length < 8) return c.json({ error: "New password must be at least 8 characters." }, 400);
  const salt = newSalt();
  await c.env.DB.prepare(`UPDATE users SET pass_hash=?, pass_salt=? WHERE id=?`).bind(await hashPassword(String(next), salt), salt, me.id).run();
  return c.json({ ok: true });
}

export default users;
