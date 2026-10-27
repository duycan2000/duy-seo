/** Normalise a domain or URL to a bare hostname without www. */
export function normDomain(input: string | null | undefined): string {
  if (!input) return "";
  let s = String(input).trim().toLowerCase();
  try {
    if (!/^https?:\/\//.test(s)) s = "http://" + s;
    s = new URL(s).hostname;
  } catch {
    /* keep as is */
  }
  return s.replace(/^www\./, "").replace(/\.$/, "");
}

/** True if host belongs to target domain (exact or subdomain). */
export function matchesDomain(host: string | null | undefined, target: string): boolean {
  const h = normDomain(host);
  const t = normDomain(target);
  if (!h || !t) return false;
  return h === t || h.endsWith("." + t);
}

export function splitList(s: string | null | undefined): string[] {
  return (s || "")
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function nextRun(frequency: string): string | null {
  const d = new Date();
  if (frequency === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (frequency === "daily") d.setUTCDate(d.getUTCDate() + 1);
  else return null;
  return sqlDate(d);
}

export function sqlDate(d = new Date()): string {
  return d.toISOString().replace("T", " ").slice(0, 19);
}

/** Collect every {url, domain, title} object nested anywhere inside a value. */
export function collectLinks(node: unknown, out: { u: string; d: string; t?: string }[] = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const n of node) collectLinks(n, out);
    return out;
  }
  const o = node as Record<string, unknown>;
  if (typeof o.url === "string" && o.url.startsWith("http")) {
    const d = normDomain((o.domain as string) || o.url);
    if (!out.some((x) => x.u === o.url)) out.push({ u: o.url, d, t: (o.title as string) || (o.source as string) || undefined });
  }
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v && typeof v === "object") collectLinks(v, out);
  }
  return out;
}

export function mentionsBrand(text: string, brands: string[]): boolean {
  const t = (text || "").toLowerCase();
  return brands.some((b) => b && t.includes(b.toLowerCase()));
}

/** Points of a size x size grid centred on lat/lng, spacing in km. */
export function gridPoints(lat: number, lng: number, size: number, spacingKm: number) {
  const pts: { row: number; col: number; lat: number; lng: number }[] = [];
  const half = (size - 1) / 2;
  const dLat = spacingKm / 110.574;
  const dLng = spacingKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++)
      pts.push({
        row: r,
        col: c,
        lat: +(lat + (half - r) * dLat).toFixed(7),
        lng: +(lng + (c - half) * dLng).toFixed(7),
      });
  return pts;
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}
