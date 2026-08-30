# ShopFloor OS

A factory **black box**. Every start, pause, scrap count, and downtime reason is an append-only event. Nobody edits yesterday’s row. A mistake is a new `record.corrected` line, same as a paper log you were not allowed to white-out.

This is not another MES dashboard clone. The unit of truth is `floor_events` (PGlite by default, or Postgres). Locks and live status are projections. If the lock table lies, `npm run rebuild` reconstructs it from the log.

Built for small press shops, packing cells, and job-work floors — the kind of place where the ticket lives in a shirt pocket and the delay reason dies at shift change.

**License:** MIT · **Repo:** [github.com/MadB0i/shopfloor-os](https://github.com/MadB0i/shopfloor-os)

## Who this is for

- Operators who need one honest timeline per job (`WO-24-0841`), not six spreadsheets
- Supervisors who need *why* a press was down, with a **reason code**, not a chat message
- Auditors who must see history that cannot be silently rewritten
- Developers who want an event-sourced core they can actually read in one sitting

## What it does today

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

Demo plant: **PL-DEMO** (three assets, one work order, coded downtime/scrap reasons).

**Board:** `http://localhost:8787/` — plant clock, asset lamps, ticket IDs. Looks like a floor instrument, not a SaaS landing page. See `docs/visual.md`.

## Requirements

- Node.js 20+
- **No paid API keys.** Default database is **PGlite** (Postgres-compatible file in `./data/`). Optional: real PostgreSQL via `DATABASE_URL=postgres://...`

## Run (B0 — this is the normal path)

```bash
git clone https://github.com/MadB0i/shopfloor-os.git
cd shopfloor-os
cp .env.example .env
npm install
npm run b0
npm start
```

`npm run b0` = migrate + seed. Then open [http://localhost:8787/](http://localhost:8787/). Token field: `dev-operator`. LINK lamp turns CRT green when the log is up.

`npm test` — B1–B4 command tests. No network, no API keys.

Optional real Postgres (Docker or local) still works if you set `DATABASE_URL=postgres://shopfloor:shopfloor@localhost:5432/shopfloor` and create that role. Wrong password is `28P01` — use PGlite instead.

### HTTP examples

Raw event CSV (one row per event, including voided qty). JSON tape is auditor-only:

```bash
curl -s "http://localhost:8787/v1/export/events.csv" -H "Authorization: Bearer dev-operator" -o shopfloor-events.csv
```

OEE-lite window:

```bash
curl -s "http://localhost:8787/v1/metrics/oee?from=2026-08-30T00:00:00.000Z&to=2026-08-31T00:00:00.000Z" \
  -H "Authorization: Bearer dev-operator"
```

```bash
curl -s -X POST http://localhost:8787/v1/commands/run.start \
  -H "Authorization: Bearer dev-operator" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: run-1" \
  -d "{\"assetId\":\"M-PRESS-01\",\"workOrderId\":\"WO-24-0841\",\"operationId\":\"OP-0841-1\"}"
```

After a crash drill on locks:

```bash
npm run rebuild
```

Contract: [`openapi.yaml`](openapi.yaml)

## How the core is shaped

```
command (authenticated, plant-scoped)
    → INSERT floor_events   # never UPDATE payload
    → touch projection      # e.g. asset_locks
GET live / timeline / floor board   # read models only
```

Roles: `operator`, `supervisor`, `planner`, `auditor` (auditor cannot write).

Unknown event types and unknown reason codes are rejected. Metrics that cannot be computed from the log are omitted, not invented (`docs/metrics.md`).

## Roadmap

Capability order, no dates: [`docs/ROADMAP.md`](docs/ROADMAP.md). Architecture: [`docs/architecture.md`](docs/architecture.md).

Not in scope for this tree: ERP, GST, full warehouse, chatbots, “AI OEE”.

## Authors

| Person | Role |
| --- | --- |
| [**MadB0i**](https://github.com/MadB0i) | Author and maintainer. Domain from a year on a real production floor, then this log so that knowledge is not stuck in paper tickets. |
| **[Cursor](https://cursor.com)** | Pair-programming environment used to implement the core, docs, and board. Cursor is listed as a contributor because the code was written in that editor/agent workflow — not as a substitute for review or for plant liability. |

Full contribution rules: [`CONTRIBUTING.md`](CONTRIBUTING.md). Security notes: [`SECURITY.md`](SECURITY.md).

## Name

ShopFloor OS is a working title. The “OS” means *operator system* (log + commands), not a kernel.
