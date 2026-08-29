# Build roadmap

Order is dependency, not a calendar. A slice is done when API + fixture + test exist. The board is allowed only as a read/write face on those APIs — not as a substitute for them.

## Already on `main`

- Event store `floor_events` (no in-place edits), `schema_version`, idempotency keys
- Demo plant `PL-DEMO`, roles, bearer tokens
- Commands: run start/end, good/scrap, downtime start/end, handoff submit/accept
- Projections: `asset_locks`, `GET /v1/floor`, live asset, work-order timeline
- `npm run rebuild` for locks
- Instrument board at `/` (`web/`)
- Docs: architecture, metrics formulas, visual constraints
- Routing: cannot start seq N until seq N−1 has `run.completed`
- Pause/resume: lock stays, `openRun.paused` on the floor payload

## Spine (never drop)

Writes = commands → events. Reads = projections. Rebuild must match live locks. Reason codes, not free text. Unknown event types rejected.

---

## Next to build (this order)

### B0 — Run on this machine (done: PGlite default)
`DATABASE_URL=pglite:./data/shopfloor` — no Docker, no Postgres password, no API keys. `npm run b0` then `npm start`. Real `postgres://` still supported.

### B1 — Command tests (done)
In-memory PGlite. Double start 409, unknown scrap 400, auditor 403, idempotent replay, rebuild restores lock. `npm test`. UI not in this slice.

### B2 — Routing gate (done)
`run.start` requires previous `operation.seq` complete (seq 1 is free). Skip-ahead is 409. Board shows the API fault string; no UI restyle in this slice.

### B3 — Pause / resume (done)
`run.pause` / `run.resume`. Lock stays. `GET /v1/floor` sets `openRun.paused`. Complete from hold is allowed. OpenAPI includes pause/resume (was missing vs live routes).

### B4 — Corrections (old C7)
`POST /v1/commands/record.correct` with `replacesEventId` + reason. Insert `record.corrected` only. Projections that count qty must ignore or reverse the replaced event **by rule documented in** `docs/metrics.md`. Auditor token can read full plant tape (`GET /v1/tape?from&to`).

### B5 — OEE-lite API (old C5)
`GET /v1/metrics/oee?asset=&from=&to=` using `docs/metrics.md`. If a factor cannot be computed, omit it (`null`), do not invent. Board: one dense row under the asset (A / P / Q), not a chart widget.

### B6 — Handoff as a gate (old C6)
`handoff.submitted` snapshots open runs + open downtime. Next shift: `run.start` blocked until `handoff.accepted` for that plant/window **or** supervisor override event. Accept stays supervisor/planner-only.

### B7 — Planner catalog writes
`POST` assets, reason codes, work orders, operations (planner role). Seed stays the demo; real plants stop living only in `seed.ts`.

### B8 — Export (old C8, thin)
`GET /v1/export/events.csv?from&to` — raw log, one row per event. No “pretty report” that hides corrections.

### B9 — Ingest pressure (old C9)
429 when idempotency/event insert storms. Document backup = dump `floor_events`. Health already exists; add DB ping on `/health`.

### B10 — Edge (last)
Browser offline queue for commands (IndexedDB), flush when LINK is ok. Photos later as `media.attached` + object store. Not before B1–B4.

---

## Explicitly not this product

ERP, GST, full inventory, native apps, SAP connectors, chatbots, ML scheduling, SaaS marketing landing page.

## GitHub surface after each slice

Push the slice with a fixture + what broke if you skip the invariant. Stars follow a **runnable** board and an honest README, not a longer roadmap.

Default clone uses PGlite (file DB). Postgres is optional.
