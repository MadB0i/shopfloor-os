# ShopFloor OS

A factory **black box** — an append-only event log for press shops, packing cells, and job-work floors.

Every start, pause, scrap count, and downtime reason is an immutable event. Nobody edits yesterday's row. A mistake is a new `record.corrected` line, same as a paper log you were not allowed to white-out. If the lock table lies, `npm run rebuild` reconstructs it from the log.

Not a dashboard clone. Not an MES. The unit of truth is `floor_events` — events are facts, locks and live status are projections.

**License:** MIT · **Repo:** [github.com/MadB0i/shopfloor-os](https://github.com/MadB0i/shopfloor-os)

## Stack

- **Runtime:** Node.js 20+, TypeScript, [Fastify 5](https://fastify.dev)
- **Database:** PostgreSQL 16 (Docker) or [PGlite](https://github.com/electric-sql/pglite) (local dev, zero config)
- **Validation:** [Zod](https://zod.dev) schemas per command
- **No ORM.** Raw SQL migrations in `sql/`. You can read every query in one sitting.

## Quick start

```bash
git clone https://github.com/MadB0i/shopfloor-os.git
cd shopfloor-os
cp .env.example .env
docker compose up -d          # starts Postgres + the app
# or, without Docker:
npm install && npm run b0 && npm start
```

Open [http://localhost:8787/](http://localhost:8787/) — token field: `dev-operator`. The board shows a live floor with asset lamps, a tape of recent events, and OEE scores.

## What it does

| You send | The log stores |
| --- | --- |
| Start / hold / resume / complete a run | `run.started` / `run.paused` / `run.resumed` / `run.completed` + asset lock |
| Good qty / scrap qty | `qty.good_recorded` / `qty.scrap_recorded` |
| Downtime open / close | `downtime.started` / `downtime.ended` |
| Shift handoff | `handoff.submitted` / `handoff.accepted` |
| Same command twice (flaky Wi‑Fi) | `Idempotency-Key` → same `event_id`, no double count |
| Void a bad qty (keep the tape) | `record.corrected` naming `replacesEventId` |
| Shift handoff gate | submit blocks `run.start` until ACK or SKIP |
| Planner catalog | `POST /v1/catalog/...` |

Seed plant: **PL-RIVERBEND** (three assets, one work order, coded downtime/scrap reasons, seeded events showing an active run, open downtime, and a pending handoff).

## Architecture

```
command (authenticated, plant-scoped, idempotent)
    → INSERT floor_events   # never UPDATE payload
    → touch projection      # e.g. asset_locks
GET live / timeline / floor board   # read models only
```

Roles: `operator`, `supervisor`, `planner`, `auditor` (auditor cannot write).

Unknown event types and unknown reason codes are rejected. Metrics that cannot be computed from the log are omitted, not invented ([`docs/metrics.md`](docs/metrics.md)).

Full architecture: [`docs/architecture.md`](docs/architecture.md). Visual constraints: [`docs/visual.md`](docs/visual.md).

## Key properties

- **Append-only.** `floor_events` is never UPDATEd. Corrections emit a new `record.corrected` event that names the original — the original stays on the tape with a `voided` flag.
- **Deterministic rebuild.** `npm run rebuild` wipes `asset_locks` and reconstructs it from unmatched `run.started` vs `run.completed` in the event log. The projection is a cache, not a source of truth.
- **Idempotent.** Duplicate commands (same `Idempotency-Key` + body) return the original `event_id` without double-counting. Changed body with the same key → 409.
- **Routing gate.** `run.start` for operation seq N requires seq N−1 to have `run.completed`. Skip-ahead is rejected.
- **Handoff gate.** A pending `handoff.submitted` blocks all `run.start` until a supervisor accepts or overrides.
- **OEE from events.** Availability, performance, quality are computed from downtime intervals, good qty, and target qty — null when a factor cannot be determined.

## Commands

```bash
# Start a run
curl -s -X POST http://localhost:8787/v1/commands/run.start \
  -H "Authorization: Bearer dev-operator" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: run-1" \
  -d '{"assetId":"M-PRESS-01","workOrderId":"WO-26-0841","operationId":"OP-0841-1"}'

# Record good qty
curl -s -X POST http://localhost:8787/v1/commands/qty.good \
  -H "Authorization: Bearer dev-operator" \
  -H "Content-Type: application/json" \
  -d '{"assetId":"M-PRESS-01","workOrderId":"WO-26-0841","operationId":"OP-0841-1","qty":50}'

# Export raw event CSV
curl -s "http://localhost:8787/v1/export/events.csv" \
  -H "Authorization: Bearer dev-operator" -o shopfloor-events.csv

# OEE for a window
curl -s "http://localhost:8787/v1/metrics/oee?from=2026-08-30T00:00:00.000Z&to=2026-08-31T00:00:00.000Z" \
  -H "Authorization: Bearer dev-operator"
```

Full contract: [`openapi.yaml`](openapi.yaml).

## Roadmap

Capability order, no dates: [`docs/ROADMAP.md`](docs/ROADMAP.md).

Not in scope: ERP, GST, full warehouse, chatbots, "AI OEE".

## Authors

| Person | Role |
| --- | --- |
| [**MadB0i**](https://github.com/MadB0i) | Author and maintainer. Domain from a year on a real production floor, then this log so that knowledge is not stuck in paper tickets. |
| **[Cursor](https://cursor.com)** | Pair-programming environment used to implement the core, docs, and board. Cursor is listed as a contributor because the code was written in that editor/agent workflow — not as a substitute for review or for plant liability. |

Full contribution rules: [`CONTRIBUTING.md`](CONTRIBUTING.md). Security notes: [`SECURITY.md`](SECURITY.md).

## Name

ShopFloor OS is a working title. The "OS" means *operator system* (log + commands), not a kernel.
