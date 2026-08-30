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
- Corrections: qty events voided by `record.corrected`; auditor `GET /v1/tape`
- OEE-lite: `GET /v1/metrics/oee`; board A/P/Q row
- Handoff gate + planner catalog POSTs
- CSV export of the raw event tape

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

### B4 — Corrections (done)
`POST /v1/commands/record.correct` (`replacesEventId`, `reason`). Original row stays. Qty totals skip superseded ids (`effectiveQtySum`). `GET /v1/tape?from&to` is auditor-only.

### B5 — OEE-lite API (done)
`GET /v1/metrics/oee?from=&to=&asset=`. Null if a factor cannot be computed. Board shows one dense A/P/Q/OEE row (local calendar day), not a chart.

### B6 — Handoff as a gate (done)
Latest `handoff.submitted` blocks `run.start` until matching `handoff.accepted` or `handoff.overridden` (supervisor/planner). Snapshot includes open runs and open downtime. Floor `handoff.pending`.

### B7 — Planner catalog writes (done)
`POST /v1/catalog/assets|reason-codes|work-orders|operations`. Planner only. New WO emits `work_order.opened`. Seed remains the demo plant.

### B8 — Export (done)
`GET /v1/export/events.csv?from&to` — one row per event including voided qty and `record.corrected`. `voided` column is a flag, not a filter. Any plant bearer can download CSV; JSON `GET /v1/tape` stays auditor-only. Limit 50 000.

### B9 — Ingest pressure
`/health` already pings the DB (B0). Remaining: ingest 429, backup = dump `floor_events`.

### B10 — Edge (last)
Browser offline queue for commands (IndexedDB), flush when LINK is ok. Photos later as `media.attached` + object store. Not before B1–B4.

---

## Explicitly not this product

ERP, GST, full inventory, native apps, SAP connectors, chatbots, ML scheduling, SaaS marketing landing page.

## GitHub surface after each slice

Push the slice with a fixture + what broke if you skip the invariant. Stars follow a **runnable** board and an honest README, not a longer roadmap.

Default clone uses PGlite (file DB). Postgres is optional.
