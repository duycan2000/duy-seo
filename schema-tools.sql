-- Research & utility tools (SERP cache, jobs, Search Console sites, IndexNow)
CREATE TABLE IF NOT EXISTS serp_cache (
  keyword TEXT NOT NULL,
  loc TEXT NOT NULL,            -- location_code or coordinate key
  lang TEXT NOT NULL,
  device TEXT NOT NULL,
  urls TEXT NOT NULL,           -- JSON [{p,u,d,t}] top 10 organic
  features TEXT,                -- JSON array of SERP feature types
  fetched_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (keyword, loc, lang, device)
);

CREATE TABLE IF NOT EXISTS tool_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,           -- serp_cluster
  name TEXT,
  params TEXT NOT NULL,         -- JSON
  status TEXT DEFAULT 'running',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gsc_sites (
  property TEXT PRIMARY KEY,    -- sc-domain:example.com or https://example.com/
  label TEXT,
  project_id INTEGER,
  added_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS indexnow_keys (
  host TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  verified_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS indexnow_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host TEXT NOT NULL,
  urls INTEGER,
  status INTEGER,
  message TEXT,
  sent_at TEXT DEFAULT (datetime('now'))
);
