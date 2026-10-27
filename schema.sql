-- Duy SEO platform — D1 schema
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,                 -- e.g. duy.digital (no protocol, no www)
  brand_names TEXT DEFAULT '',          -- comma-separated, used for AI mention detection
  competitors TEXT DEFAULT '',          -- comma-separated domains
  location_code INTEGER DEFAULT 2704,   -- 2704 = Vietnam, 2840 = United States
  language_code TEXT DEFAULT 'en',
  device TEXT DEFAULT 'desktop',
  depth INTEGER DEFAULT 50,             -- SERP depth (cost scales with depth)
  frequency TEXT DEFAULT 'daily',       -- daily | weekly | manual
  business_name TEXT DEFAULT '',        -- for Local SEO matching
  place_cid TEXT DEFAULT '',            -- Google Maps CID (most reliable match)
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  tags TEXT DEFAULT '',
  engines TEXT DEFAULT 'google,ai_overview', -- google, bing, ai_overview, ai_mode
  search_volume INTEGER,
  next_run_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(project_id, keyword)
);

-- engine: google | bing | ai_overview | ai_mode
CREATE TABLE IF NOT EXISTS rank_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  engine TEXT NOT NULL,
  checked_at TEXT DEFAULT (datetime('now')),
  position INTEGER,            -- organic position (null = not in top N); for AI = citation order
  url TEXT,
  present INTEGER DEFAULT 0,   -- AI: answer box shown at all
  cited INTEGER DEFAULT 0,     -- AI: domain cited / mentioned
  features TEXT,               -- JSON array of SERP feature types
  top TEXT                     -- JSON [{d,u,p}] top results / cited domains
);
CREATE INDEX IF NOT EXISTS idx_rank_kw ON rank_history(keyword_id, engine, checked_at);

CREATE TABLE IF NOT EXISTS ai_prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  platforms TEXT DEFAULT 'chatgpt,ai_mode',
  next_run_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt_id INTEGER NOT NULL REFERENCES ai_prompts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,       -- chatgpt | ai_mode
  checked_at TEXT DEFAULT (datetime('now')),
  brand_mentioned INTEGER DEFAULT 0,
  domain_cited INTEGER DEFAULT 0,
  cited_position INTEGER,
  sources TEXT,                 -- JSON [{d,u,t}]
  brands TEXT,                  -- JSON [string]
  competitors_hit TEXT,         -- JSON [domain]
  excerpt TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_prompt ON ai_results(prompt_id, platform, checked_at);

CREATE TABLE IF NOT EXISTS local_grids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  center_lat REAL NOT NULL,
  center_lng REAL NOT NULL,
  size INTEGER DEFAULT 5,       -- 3, 5, 7 (size x size points)
  spacing_km REAL DEFAULT 1,
  zoom INTEGER DEFAULT 15,
  next_run_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS local_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grid_id INTEGER NOT NULL REFERENCES local_grids(id) ON DELETE CASCADE,
  started_at TEXT DEFAULT (datetime('now')),
  points_total INTEGER,
  points_done INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS local_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id INTEGER NOT NULL REFERENCES local_scans(id) ON DELETE CASCADE,
  row INTEGER, col INTEGER, lat REAL, lng REAL,
  rank INTEGER,                 -- null = not in top 20
  top TEXT                      -- JSON top 3 [{t,r,v}]
);
CREATE INDEX IF NOT EXISTS idx_lp_scan ON local_points(scan_id);

CREATE TABLE IF NOT EXISTS audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  status TEXT DEFAULT 'crawling',  -- crawling | finished | error
  max_pages INTEGER,
  summary TEXT,
  pages TEXT,
  started_at TEXT DEFAULT (datetime('now')),
  finished_at TEXT
);

-- DataForSEO Standard-mode tasks waiting to be collected
CREATE TABLE IF NOT EXISTS pending_tasks (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,            -- rank | ai_mode_prompt | local_point
  get_path TEXT NOT NULL,
  ref TEXT NOT NULL,             -- JSON context
  created_at TEXT DEFAULT (datetime('now')),
  attempts INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS api_usage (
  day TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  calls INTEGER DEFAULT 0,
  cost REAL DEFAULT 0,
  PRIMARY KEY (day, endpoint)
);

CREATE TABLE IF NOT EXISTS cache (
  key TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
