/** IndexNow: per-host keys, key-file verification, URL submission (Bing, Yandex, Naver, Seznam, Yep share submissions). */
import type { Env } from "../types";

const hostOf = (u: string) => new URL(/^https?:\/\//.test(u) ? u : "https://" + u).host.toLowerCase();
const newKey = () => {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
};

export async function listHosts(env: Env) {
  const hosts = (await env.DB.prepare(`SELECT * FROM indexnow_keys ORDER BY host`).all<any>()).results;
  const log = (await env.DB.prepare(`SELECT * FROM indexnow_log ORDER BY sent_at DESC LIMIT 50`).all<any>()).results;
  return { hosts, log };
}

export async function addHost(env: Env, input: string) {
  const host = hostOf(input);
  const existing = await env.DB.prepare(`SELECT * FROM indexnow_keys WHERE host=?`).bind(host).first<any>();
  if (existing) return existing;
  const key = newKey();
  await env.DB.prepare(`INSERT INTO indexnow_keys(host, key) VALUES (?,?)`).bind(host, key).run();
  return { host, key };
}

export async function verifyHost(env: Env, host: string) {
  const row = await env.DB.prepare(`SELECT * FROM indexnow_keys WHERE host=?`).bind(host).first<any>();
  if (!row) throw new Error("Unknown host");
  const r = await fetch(`https://${host}/${row.key}.txt`, { signal: AbortSignal.timeout(10000) }).catch(() => null);
  const ok = !!r && r.ok && (await r.text()).trim() === row.key;
  if (ok) await env.DB.prepare(`UPDATE indexnow_keys SET verified_at=datetime('now') WHERE host=?`).bind(host).run();
  return { ok, url: `https://${host}/${row.key}.txt` };
}

export async function deleteHost(env: Env, host: string) {
  await env.DB.prepare(`DELETE FROM indexnow_keys WHERE host=?`).bind(host).run();
}

/** Submit URLs, grouped by host (IndexNow needs one host per request, up to 10,000 URLs). */
export async function submit(env: Env, urls: string[]) {
  const groups = new Map<string, string[]>();
  for (const u of urls.map((x) => x.trim()).filter((x) => /^https?:\/\//.test(x))) {
    const h = hostOf(u);
    if (!groups.has(h)) groups.set(h, []);
    groups.get(h)!.push(u);
  }
  const results: { host: string; urls: number; status: number; message: string }[] = [];
  for (const [host, list] of groups) {
    let row = await env.DB.prepare(`SELECT * FROM indexnow_keys WHERE host=?`).bind(host).first<any>();
    if (!row) { results.push({ host, urls: list.length, status: 0, message: "No key for this host — add it first" }); continue; }
    for (let i = 0; i < list.length; i += 10000) {
      const chunk = list.slice(i, i + 10000);
      const r = await fetch("https://api.indexnow.org/indexnow", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ host, key: row.key, keyLocation: `https://${host}/${row.key}.txt`, urlList: chunk }),
      }).catch(() => ({ status: 0, text: async () => "Couldn't reach api.indexnow.org — try again" }) as any);
      const message = r.status === 200 ? "Accepted" : r.status === 202 ? "Received (key validation pending)" : r.status === 403 ? "Key not valid — check the key file" : r.status === 422 ? "URLs don't belong to the host or key mismatch" : r.status === 429 ? "Too many requests — slow down" : (await r.text()).slice(0, 200) || `HTTP ${r.status}`;
      await env.DB.prepare(`INSERT INTO indexnow_log(host, urls, status, message) VALUES (?,?,?,?)`).bind(host, chunk.length, r.status, message).run();
      results.push({ host, urls: chunk.length, status: r.status, message });
    }
  }
  return results;
}
