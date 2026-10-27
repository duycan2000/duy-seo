-- Rank & Rent module — kept in separate rr_* / market_* tables (never shown in client SEO views)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  region TEXT NOT NULL,
  country TEXT NOT NULL,            -- AU | NZ
  population INTEGER,               -- approx. urban population
  lat REAL, lng REAL,
  regional INTEGER DEFAULT 0,       -- 1 = regional city
  location_code INTEGER,            -- Google Ads / SERP city code (resolved from DataForSEO)
  UNIQUE(name, country)
);

CREATE TABLE IF NOT EXISTS rr_sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL UNIQUE,
  niche TEXT NOT NULL,
  city_id INTEGER REFERENCES cities(id),
  country TEXT DEFAULT 'AU',
  theme TEXT DEFAULT '',
  launch_date TEXT,
  status TEXT DEFAULT 'researching', -- researching|building|ranking|trial|rented|for_sale|sold
  tracking_phone TEXT DEFAULT '',    -- display number on the site
  twilio_number TEXT DEFAULT '',     -- E.164, used to match Twilio webhooks
  forward_to TEXT DEFAULT '',        -- E.164 the platform's TwiML forwards calls to
  lead_destination TEXT DEFAULT '',  -- free text: email / SMS / webhook
  tenant_name TEXT DEFAULT '',
  tenant_contact TEXT DEFAULT '',
  monthly_rent REAL DEFAULT 0,
  currency TEXT DEFAULT 'AUD',
  rent_paid_until TEXT,              -- YYYY-MM-DD; alert when past (until Billing ships)
  domain_expiry TEXT,                -- YYYY-MM-DD (auto from RDAP when available)
  gsc_property TEXT DEFAULT '',      -- e.g. sc-domain:example.com.au
  key_pages TEXT DEFAULT '',         -- URLs to inspect for indexing, one per line
  uptime_url TEXT DEFAULT '',        -- default https://domain/
  form_test_url TEXT DEFAULT '',     -- endpoint for the weekly synthetic form test
  lead_secret TEXT NOT NULL,         -- HMAC secret for lead ingestion
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rr_keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES rr_sites(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  next_run_at TEXT DEFAULT (datetime('now')),
  UNIQUE(site_id, keyword)
);

CREATE TABLE IF NOT EXISTS rr_rank_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword_id INTEGER NOT NULL REFERENCES rr_keywords(id) ON DELETE CASCADE,
  checked_at TEXT DEFAULT (datetime('now')),
  position INTEGER,        -- organic (mobile, city location)
  map_pack INTEGER,        -- position in the local pack, null if absent
  url TEXT
);
CREATE INDEX IF NOT EXISTS idx_rrrank ON rr_rank_history(keyword_id, checked_at);

CREATE TABLE IF NOT EXISTS rr_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES rr_sites(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                -- form | call
  received_at TEXT DEFAULT (datetime('now')),
  name TEXT, phone TEXT, email TEXT, message TEXT,
  page TEXT, utm TEXT,
  status TEXT DEFAULT 'new',         -- new|sent|qualified|spam|duplicate
  spam_score INTEGER DEFAULT 0,
  spam_reasons TEXT,
  call_sid TEXT,
  duplicate_of INTEGER
);
CREATE INDEX IF NOT EXISTS idx_rrleads ON rr_leads(site_id, received_at);

CREATE TABLE IF NOT EXISTS rr_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER REFERENCES rr_sites(id) ON DELETE CASCADE,
  call_sid TEXT UNIQUE NOT NULL,
  from_number TEXT, to_number TEXT,
  started_at TEXT DEFAULT (datetime('now')),
  duration INTEGER DEFAULT 0,        -- seconds talked with the tenant
  status TEXT,                       -- Twilio status / DialCallStatus
  answered INTEGER DEFAULT 0,
  recording_url TEXT,
  first_time INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_rrcalls ON rr_calls(site_id, started_at);

CREATE TABLE IF NOT EXISTS rr_gsc_daily (
  site_id INTEGER NOT NULL REFERENCES rr_sites(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  clicks INTEGER, impressions INTEGER, ctr REAL, position REAL,
  PRIMARY KEY (site_id, date)
);

CREATE TABLE IF NOT EXISTS rr_gsc_top (
  site_id INTEGER NOT NULL REFERENCES rr_sites(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                -- query | page
  key TEXT NOT NULL,
  clicks INTEGER, impressions INTEGER, ctr REAL, position REAL,
  PRIMARY KEY (site_id, kind, key)
);

CREATE TABLE IF NOT EXISTS rr_index_status (
  site_id INTEGER NOT NULL REFERENCES rr_sites(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  verdict TEXT, coverage TEXT, last_crawl TEXT,
  checked_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (site_id, url)
);

-- one row per site + check kind: uptime | ssl | domain | form | gsc
CREATE TABLE IF NOT EXISTS rr_checks (
  site_id INTEGER NOT NULL REFERENCES rr_sites(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ok INTEGER,
  fails INTEGER DEFAULT 0,
  detail TEXT,
  checked_at TEXT DEFAULT (datetime('now')),
  last_ok_at TEXT,
  PRIMARY KEY (site_id, kind)
);

CREATE TABLE IF NOT EXISTS rr_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER REFERENCES rr_sites(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  severity TEXT DEFAULT 'warn',      -- info | warn | critical
  message TEXT NOT NULL,
  dedupe_key TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  sent_at TEXT,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_rralerts ON rr_alerts(dedupe_key, resolved_at);

CREATE TABLE IF NOT EXISTS rr_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS market_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  niches TEXT NOT NULL,              -- JSON array
  city_ids TEXT NOT NULL,            -- JSON array
  status TEXT DEFAULT 'running',     -- running | scoring | done | error
  error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS market_research (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES market_jobs(id) ON DELETE CASCADE,
  niche TEXT NOT NULL,
  city_id INTEGER NOT NULL REFERENCES cities(id),
  volume INTEGER,                    -- city-level monthly searches (sum of the niche keyword set)
  volume_scope TEXT,                 -- city | country (fallback)
  cpc REAL,
  top_bid REAL,
  kd INTEGER,
  serp_done INTEGER DEFAULT 0,
  ads_done INTEGER DEFAULT 0,
  vol_done INTEGER DEFAULT 0,
  top10 TEXT,                        -- JSON [{p,d,dir}]
  map_pack TEXT,                     -- JSON [{t,r,v,d}]
  directories INTEGER,
  ads_in_serp INTEGER,
  advertisers INTEGER,
  top3 TEXT,                         -- JSON [{d, rd}]
  top3_rd INTEGER,                   -- avg referring main domains of top 3 non-directory results
  score INTEGER,
  shortlisted_site_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mr_job ON market_research(job_id);
