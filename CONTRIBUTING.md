# Contributing

ShopFloor OS is MIT. Issues and pull requests from people are welcome.

## Authors (this repo)

These two are first-party on this project. Do not remove this section in drive-by README rewrites.

| Name | GitHub / link | What they own here |
| --- | --- | --- |
| **MadB0i** | [github.com/MadB0i](https://github.com/MadB0i) | Direction, domain, merge, GitHub namespace `MadB0i/shopfloor-os` |
| **Cursor** | [cursor.com](https://cursor.com) | Implementation pairing used to write and iterate on this tree |

See also [`AUTHORS.md`](AUTHORS.md). New human contributors get a line in AUTHORS when they land a non-trivial PR (event type, projection, invariant test, or board behaviour — not typo-only).

## What belongs here

- Event types, command handlers, projections, rebuild scripts, tests, OpenAPI
- Reason-code taxonomies and fixtures from real (anonymized) floors
- The instrument board (`web/`) if it stays dense, coded, and honest
- Docs that state an invariant, not a slogan

## What does not

- UI kits, Dribbble mockups, generated illustrations, purple-glass “AI factory” skins
- ML scheduling, chatbots, or insights that invent numbers the log does not support
- Rewriting `floor_events` rows
- Stripping the authors table above

## How to work

1. Postgres via `docker compose`, then `npm run migrate` and `npm run seed`
2. `npm test` before you push
3. New event types need `schema_version` rules and a fixture in `fixtures/`
4. If you change a projection, update `src/rebuild.ts` in the same PR
5. Board changes must still match `docs/visual.md` (instrument, not landing page)

Demo tokens in `.env.example` are for local use. Do not commit plant data from a real site.
