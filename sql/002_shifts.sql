-- Shifts catalog — a named shift per plant, so handoff commands reference a
-- real shift code instead of a hardcoded pair (the board used "A"/"B").
-- Planner-only writes via POST /v1/catalog/shifts. Matches the catalog style
-- of assets / reason_codes: id + plant-scoped unique code.

CREATE TABLE IF NOT EXISTS shifts (
  id            TEXT PRIMARY KEY,
  plant_id      TEXT NOT NULL REFERENCES plants (id),
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  starts_at     TEXT,  -- e.g. "06:00"
  ends_at       TEXT,  -- e.g. "14:00"
  UNIQUE (plant_id, code)
);