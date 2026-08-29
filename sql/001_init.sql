-- ShopFloor OS — event log first. Rows are facts, not a live spreadsheet.
-- Idempotent so `npm run migrate` can run twice (B0 / vibe-coder machines).

CREATE TABLE IF NOT EXISTS plants (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  plant_id      TEXT NOT NULL REFERENCES plants (id),
  user_id       TEXT NOT NULL REFERENCES users (id),
  role          TEXT NOT NULL CHECK (role IN ('operator', 'supervisor', 'planner', 'auditor')),
  PRIMARY KEY (plant_id, user_id)
);

CREATE TABLE IF NOT EXISTS assets (
  id            TEXT PRIMARY KEY,
  plant_id      TEXT NOT NULL REFERENCES plants (id),
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  UNIQUE (plant_id, code)
);

CREATE TABLE IF NOT EXISTS reason_codes (
  id            TEXT PRIMARY KEY,
  plant_id      TEXT NOT NULL REFERENCES plants (id),
  kind          TEXT NOT NULL CHECK (kind IN ('downtime', 'scrap')),
  code          TEXT NOT NULL,
  label         TEXT NOT NULL,
  UNIQUE (plant_id, kind, code)
);

CREATE TABLE IF NOT EXISTS work_orders (
  id            TEXT PRIMARY KEY,
  plant_id      TEXT NOT NULL REFERENCES plants (id),
  code          TEXT NOT NULL,
  due_at        TIMESTAMPTZ,
  target_qty    INTEGER NOT NULL CHECK (target_qty >= 0),
  UNIQUE (plant_id, code)
);

CREATE TABLE IF NOT EXISTS operations (
  id            TEXT PRIMARY KEY,
  work_order_id TEXT NOT NULL REFERENCES work_orders (id),
  seq           INTEGER NOT NULL CHECK (seq >= 1),
  name          TEXT NOT NULL,
  default_asset_id TEXT REFERENCES assets (id),
  UNIQUE (work_order_id, seq)
);

CREATE TABLE IF NOT EXISTS floor_events (
  id              BIGSERIAL PRIMARY KEY,
  event_id        TEXT NOT NULL UNIQUE,
  plant_id        TEXT NOT NULL REFERENCES plants (id),
  type            TEXT NOT NULL,
  schema_version  INTEGER NOT NULL CHECK (schema_version >= 1),
  actor_id        TEXT NOT NULL REFERENCES users (id),
  asset_id        TEXT REFERENCES assets (id),
  work_order_id   TEXT REFERENCES work_orders (id),
  operation_id    TEXT REFERENCES operations (id),
  payload         JSONB NOT NULL DEFAULT '{}',
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS floor_events_plant_time ON floor_events (plant_id, recorded_at);
CREATE INDEX IF NOT EXISTS floor_events_wo ON floor_events (work_order_id);
CREATE INDEX IF NOT EXISTS floor_events_asset ON floor_events (asset_id);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  plant_id      TEXT NOT NULL,
  key           TEXT NOT NULL,
  request_hash  TEXT NOT NULL,
  event_id      TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (plant_id, key)
);

CREATE TABLE IF NOT EXISTS asset_locks (
  asset_id      TEXT PRIMARY KEY REFERENCES assets (id),
  run_event_id  TEXT NOT NULL,
  locked_by     TEXT NOT NULL REFERENCES users (id),
  locked_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
