# Contributing

ShopFloor OS is MIT. Issues and PRs are welcome.

## What belongs here

- Event types, command handlers, projections, rebuild scripts, tests, OpenAPI
- Reason-code taxonomies and fixtures from real (anonymized) floors
- Docs that state an invariant, not a slogan

## What does not

- UI kits, Dribbble mockups, generated illustrations
- ML scheduling, chatbots, or “insights” that invent numbers the log does not support
- Rewriting `floor_events` rows

## How to work

1. Postgres via `docker compose`, then `npm run migrate` and `npm run seed`
2. `npm test` before you push
3. New event types need `schema_version` rules and a fixture in `fixtures/`
4. If you change a projection, update `src/rebuild.ts` in the same PR

Demo tokens in `.env.example` are for local use. Do not commit plant data from a real site.
