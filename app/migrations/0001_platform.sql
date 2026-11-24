-- 工作台平台层（D1）。代码启动时也会执行同样的 CREATE IF NOT EXISTS，便于旧站点平滑升级。
CREATE TABLE IF NOT EXISTS ds_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ds_entity (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  body TEXT NOT NULL,
  seq INTEGER NOT NULL,
  saved_at TEXT NOT NULL,
  PRIMARY KEY (collection, id)
);
CREATE TABLE IF NOT EXISTS ds_history (
  hid INTEGER PRIMARY KEY AUTOINCREMENT,
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  body TEXT NOT NULL,
  saved_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ds_session (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ds_notice (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE TABLE IF NOT EXISTS ds_login (ip TEXT NOT NULL, at TEXT NOT NULL);

CREATE INDEX IF NOT EXISTS ds_entity_collection ON ds_entity(collection, seq DESC);
CREATE INDEX IF NOT EXISTS ds_history_lookup ON ds_history(collection, id, saved_at DESC);
CREATE INDEX IF NOT EXISTS ds_session_expiry ON ds_session(expires_at);
CREATE INDEX IF NOT EXISTS ds_notice_unread ON ds_notice(read_at, created_at DESC);
