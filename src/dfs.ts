import type { Env } from "./types";

export class DfsError extends Error {
  constructor(message: string, public code?: number) {
    super(message);
  }
}

/** Thin DataForSEO v3 client with cost logging. */
export class Dfs {
  private base: string;
  private auth: string;
  constructor(private env: Env) {
    this.base = env.DFS_BASE ? env.DFS_BASE : env.DFS_SANDBOX === "1" ? "https://sandbox.dataforseo.com/v3/" : "https://api.dataforseo.com/v3/";
    this.auth = "Basic " + btoa(`${env.DFS_LOGIN}:${env.DFS_PASSWORD}`);
  }

  private async request(path: string, body?: unknown): Promise<any> {
    if (!this.env.DFS_LOGIN) throw new DfsError("DataForSEO credentials are not set (DFS_LOGIN / DFS_PASSWORD).");
    const res = await fetch(this.base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: this.auth, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json: any = await res.json().catch(() => null);
    if (!json) throw new DfsError(`DataForSEO HTTP ${res.status}`);
    if (json.status_code !== 20000) throw new DfsError(json.status_message || "DataForSEO error", json.status_code);
    await this.logCost(path, json.cost || 0);
    return json;
  }

  private async logCost(path: string, cost: number) {
    const endpoint = path.replace(/\/[0-9a-f-]{20,}$/i, "").replace(/\/(live|task_post|task_get).*$/, "");
    const day = new Date().toISOString().slice(0, 10);
    await this.env.DB.prepare(
      `INSERT INTO api_usage(day, endpoint, calls, cost) VALUES (?,?,1,?)
       ON CONFLICT(day, endpoint) DO UPDATE SET calls = calls + 1, cost = cost + excluded.cost`
    )
      .bind(day, endpoint, cost)
      .run();
  }

  /** Live call with a single task; returns tasks[0].result[0] (or throws). */
  async live(path: string, task: Record<string, unknown>): Promise<any> {
    const json = await this.request(path, [task]);
    const t = json.tasks?.[0];
    if (!t || t.status_code !== 20000) throw new DfsError(t?.status_message || "Task failed", t?.status_code);
    return t.result?.[0] ?? null;
  }

  /** Standard method: post one task, returns task id. */
  async post(path: string, task: Record<string, unknown>): Promise<string> {
    const json = await this.request(path, [task]);
    const t = json.tasks?.[0];
    if (!t || (t.status_code !== 20100 && t.status_code !== 20000)) throw new DfsError(t?.status_message || "Task post failed", t?.status_code);
    return t.id as string;
  }

  /** Standard method: fetch result. Returns null while still queued. */
  async get(path: string): Promise<any | null> {
    const json = await this.request(path);
    const t = json.tasks?.[0];
    if (!t) return null;
    if (t.status_code === 40601 || t.status_code === 40602 || t.status_code === 20100) return null; // handed / in queue
    if (t.status_code !== 20000) throw new DfsError(t.status_message, t.status_code);
    return t.result?.[0] ?? null;
  }

  /** Like get() but returns the whole result array (Google Ads endpoints return one row per keyword). undefined = still queued. */
  async getAll(path: string): Promise<any[] | undefined> {
    const json = await this.request(path);
    const t = json.tasks?.[0];
    if (!t) return undefined;
    if (t.status_code === 40601 || t.status_code === 40602 || t.status_code === 20100) return undefined;
    if (t.status_code !== 20000) throw new DfsError(t.status_message, t.status_code);
    return t.result || [];
  }

  /** GET a reference list (locations etc.) — returns tasks[0].result. */
  async list(path: string): Promise<any[]> {
    const json = await this.request(path);
    return json.tasks?.[0]?.result || [];
  }

  async userData() {
    const json = await this.request("appendix/user_data");
    return json.tasks?.[0]?.result?.[0] ?? null;
  }
}

/** Cached Live call for research endpoints (Labs, backlinks) — avoids paying twice. */
export async function cachedLive(env: Env, path: string, task: Record<string, unknown>, maxAgeHours = 72) {
  const key = path + ":" + JSON.stringify(task);
  const row = await env.DB.prepare(
    `SELECT data FROM cache WHERE key = ? AND created_at > datetime('now', ?)`
  )
    .bind(key, `-${maxAgeHours} hours`)
    .first<{ data: string }>();
  if (row) return JSON.parse(row.data);
  const data = await new Dfs(env).live(path, task);
  await env.DB.prepare(`INSERT OR REPLACE INTO cache(key, data, created_at) VALUES (?,?,datetime('now'))`)
    .bind(key, JSON.stringify(data))
    .run();
  return data;
}
