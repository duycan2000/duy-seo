import { Dfs } from "../dfs";
import type { Env, Project } from "../types";
import { gridPoints, mapLimit, matchesDomain } from "../util";

export interface GridRow {
  id: number;
  project_id: number;
  keyword: string;
  center_lat: number;
  center_lng: number;
  size: number;
  spacing_km: number;
  zoom: number;
}

export async function runGrid(env: Env, p: Project, g: GridRow, mode: "live" | "standard") {
  const pts = gridPoints(g.center_lat, g.center_lng, g.size, g.spacing_km);
  const scan = await env.DB.prepare(`INSERT INTO local_scans(grid_id, points_total) VALUES (?,?) RETURNING id`)
    .bind(g.id, pts.length)
    .first<{ id: number }>();
  const scanId = scan!.id;
  const dfs = new Dfs(env);
  const errors: string[] = [];
  await mapLimit(pts, mode === "live" ? 6 : 10, async (pt) => {
    const task = {
      keyword: g.keyword,
      location_coordinate: `${pt.lat},${pt.lng},${g.zoom}z`,
      language_code: p.language_code,
      depth: 20,
    };
    const ref = { scan_id: scanId, project_id: p.id, ...pt };
    try {
      if (mode === "live") {
        await processMapsPoint(env, ref, await dfs.live("serp/google/maps/live/advanced", task));
      } else {
        const id = await dfs.post("serp/google/maps/task_post", task);
        await env.DB.prepare(`INSERT OR IGNORE INTO pending_tasks(id, kind, get_path, ref) VALUES (?,?,?,?)`)
          .bind(id, "local_point", `serp/google/maps/task_get/advanced/${id}`, JSON.stringify(ref))
          .run();
      }
    } catch (e: any) {
      errors.push(e.message);
    }
  });
  return { scanId, errors };
}

export async function processMapsPoint(
  env: Env,
  ref: { scan_id: number; project_id: number; row: number; col: number; lat: number; lng: number },
  result: any
) {
  const p = await env.DB.prepare(`SELECT * FROM projects WHERE id = ?`).bind(ref.project_id).first<Project>();
  if (!p) return;
  const items: any[] = (result?.items || []).filter((i: any) => i.type === "maps_search");
  const name = (p.business_name || "").toLowerCase().trim();
  const hit = items.find(
    (i) =>
      (p.place_cid && String(i.cid) === String(p.place_cid)) ||
      (p.domain && i.domain && matchesDomain(i.domain, p.domain)) ||
      (name && (i.title || "").toLowerCase().includes(name))
  );
  const top = items.slice(0, 3).map((i) => ({ t: i.title, r: i.rating?.value ?? null, v: i.rating?.votes_count ?? null }));
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO local_points(scan_id, row, col, lat, lng, rank, top) VALUES (?,?,?,?,?,?,?)`).bind(
      ref.scan_id, ref.row, ref.col, ref.lat, ref.lng, hit ? hit.rank_group : null, JSON.stringify(top)
    ),
    env.DB.prepare(`UPDATE local_scans SET points_done = points_done + 1 WHERE id = ?`).bind(ref.scan_id),
  ]);
}

/** Find a business on Google Maps so the user can pick its CID / coordinates. */
export async function findBusiness(env: Env, query: string, location_code: number, language_code: string) {
  const result = await new Dfs(env).live("serp/google/maps/live/advanced", { keyword: query, location_code, language_code, depth: 10 });
  return (result?.items || [])
    .filter((i: any) => i.type === "maps_search")
    .map((i: any) => ({
      title: i.title, cid: i.cid, address: i.address, domain: i.domain,
      lat: i.latitude, lng: i.longitude, rating: i.rating?.value, votes: i.rating?.votes_count, category: i.category,
    }));
}
