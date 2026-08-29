# Roadmap

Order is dependency, not a calendar. A capability is done when API + tests + fixtures exist. Screens are not a milestone.

## Spine

Source of truth is `floor_events`. Commands append. Reads use projections. Rebuild must reproduce locks from the log.

## Capabilities

**C0 — Tenancy & identity**  
Plant, users, roles (`operator`, `supervisor`, `planner`, `auditor`). Demo tokens only until a real IdP is wired.

**C1 — Catalog**  
Assets, downtime/scrap reason codes (codes, not free text), work orders, numbered operations.

**C2 — Event ingest**  
Typed events, `schema_version`, `Idempotency-Key`, unknown types rejected.

**C3 — Live projection**  
Per asset: open run, open downtime. Asset lock so two starts collide.

**C4 — Work order queue**  
Routing sequence; block if previous operation incomplete.

**C5 — OEE-lite**  
Availability, performance, quality from events. Formulas in `docs/metrics.md`.

**C6 — Shift handoff**  
Snapshot of open runs/downtime/material; next shift must accept.

**C7 — Corrections & auditor stream**  
`record.corrected` points at a prior `event_id`. Timeline query.

**C8 — Jobs**  
Shift close warnings, naive due-date vs historical rate, CSV export of events.

**C9 — Reliability**  
Ingest 429, backups = the events table.

**C10 — Edge**  
Offline client queue, scrap photos as `media.attached`.

## Out of v1

ERP, GST, full inventory, native mobile, SAP, ML.

## GitHub

Public MIT. No paid API. Postgres is the only service.
