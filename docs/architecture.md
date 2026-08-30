# Architecture

```
operator / supervisor / later: device
        ↓
HTTP commands  (plant-scoped bearer token, Idempotency-Key)
        ↓
SQL transaction: validate → INSERT floor_events → update lock projection
        ↓
GET live / timeline  (read models, not ad-hoc table edits)
```

`floor_events` is never updated. `asset_locks` is a projection; `npm run rebuild` wipes and fills it from unmatched `run.started` vs `run.completed`. Pause/resume do not drop the lock. `openRun.paused` is derived from unmatched `run.paused` vs `run.resumed` after that start.

Default local store is PGlite (`pglite:./data/shopfloor`). `DATABASE_URL=postgres://...` connects to real Postgres (Docker or local).

Clock: `recorded_at` is server insert time. `occurred_at` may be passed later; until then it defaults to now.

Schema evolution: bump `CURRENT_SCHEMA` in `src/events/catalog.ts` and keep readers tolerant of older rows.
