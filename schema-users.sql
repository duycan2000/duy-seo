-- Team accounts (the owner signs in with the ADMIN_PASSWORD secret and isn't stored here)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'member',   -- admin | member | viewer
  pass_hash TEXT NOT NULL,               -- PBKDF2-SHA256, 100k iterations
  pass_salt TEXT NOT NULL,
  disabled INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  last_login_at TEXT
);
