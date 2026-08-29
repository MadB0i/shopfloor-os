-- ShopFloor OS — event log first. Rows are facts, not a live spreadsheet.

CREATE TABLE plants (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE plant_role AS ENUM ('operator', 'supervisor', 'planner', 'auditor');

CREATE TABLE memberships (
  plant_id      TEXT NOT NULL REFERENCES plants (id),
  user_id       TEXT NOT NULL REFERENCES users (id),
  role          plant_role NOT NULL,
  PRIMARY KEY (plant_id, user_id)
);

CREATE TABLE assets (
  id            TEXT PRIMARY KEY,
  plant_id      TEXT NOT NULL REFERENCES plants (id),
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  UNIQUE (plant_id, code)
);

CREATE TYPE reason_kind AS ENUM ('downtime', 'scrap');

CREATE TABLE reason_codes (
  id            TEXT PRIMARY KEY,
  plant_id      TEXT NOT NULL REFERENCES plants (id),
  kind          reason_kind NOT NULL,
  code          TEXT NOT NULL,
  label         TEXT NOT NULL,
  UNIQUE (plant_id, kind, code)
);

CREATE TABLE work_orders (
  id            TEXT PRIMARY KEY,
  plant_id      TEXT NOT NULL REFERENCES plants (id),
  code          TEXT NOT NULL,
  due_at        TIMESTAMPTZ,
  target_qty    INTEGER NOT NULL CHECK (target_qty >= 0),
  UNIQUE (plant_id, code)
);

CREATE TABLE operations (
  id            TEXT PRIMARY KEY,
  work_order_id TEXT NOT NULL REFERENCES work_orders (id),
  seq           INTEGER NOT NULL CHECK (seq >= 1),
  name          TEXT NOT NULL,
  default_asset_id TEXT REFERENCES assets (id),
  UNIQUE (work_order_id, seq)
);

-- Source of truth. Never UPDATE payload. Corrections are new rows.
CREATE TABLE floor_events (
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

CREATE INDEX floor_events_plant_time ON floor_events (plant_id, recorded_at);
CREATE INDEX floor_events_wo ON floor_events (work_order_id);
CREATE INDEX floor_events_asset ON floor_events (asset_id);

CREATE TABLE idempotency_keys (
  plant_id      TEXT NOT NULL,
  key           TEXT NOT NULL,
  request_hash  TEXT NOT NULL,
  event_id      TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (plant_id, key)
);

CREATE TABLE asset_locks (
  asset_id      TEXT PRIMARY KEY REFERENCES assets (id),
  run_event_id  TEXT NOT NULL,
  locked_by     TEXT NOT NULL REFERENCES users (id),
  locked_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
