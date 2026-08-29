# ShopFloor OS

Append-only event log for a factory floor. Jobs, downtime, scrap, and shift handoff are facts in `floor_events`. Nothing in that table is updated in place. A wrong count is a `record.corrected` event, not an edit.

This is not a generic MES skin and not a KPI wallpaper. The product is the log plus a rebuildable lock table so two operators cannot start the same press without a rule firing.

## Status

Capability slice **C0–C2** (identity, catalog, ingest) plus the first write commands:

- `POST /v1/commands/run.start`
- `POST /v1/commands/qty.scrap`
- `POST /v1/commands/downtime.start`
- `GET /v1/plants/:plantId/assets/:assetId/live`
- `GET /v1/work-orders/:id/timeline`

UI is intentionally absent.

## Run locally

Needs Docker (Postgres 16) and Node 20+.

```bash
cp .env.example .env
docker compose up -d
npm install
npm run migrate
npm run seed
npm start
```

Tokens (demo plant `PL-DEMO` only):

| Role | Header |
|---|---|
| operator | `Authorization: Bearer dev-operator` |
| supervisor | `Authorization: Bearer dev-supervisor` |
| auditor (read) | `Authorization: Bearer dev-auditor` |

Start a run (repeat with the same `Idempotency-Key` to prove replay):

```bash
curl -s -X POST http://localhost:8787/v1/commands/run.start \
  -H "Authorization: Bearer dev-operator" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: run-1" \
  -d "{\"assetId\":\"M-PRESS-01\",\"workOrderId\":\"WO-24-0841\",\"operationId\":\"OP-0841-1\"}"
```

Rebuild locks from the log after a crash drill:

```bash
npm run rebuild
```

## License

MIT. Use it, fork it, run it in a plant. No telemetry in this repo.

## Docs

- [Roadmap (capabilities, no dates)](docs/ROADMAP.md)
- [Architecture](docs/architecture.md)
- [OEE-lite formulas](docs/metrics.md)
- [Visual constraints for a later UI](docs/visual.md)
- [OpenAPI](openapi.yaml)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Please do not open PRs that add a marketing landing page or an “AI copilot” on the floor log.
