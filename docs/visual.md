# Visual constraints (UI)

The HTTP API has a companion **instrument board** at `/` (`web/`). It is a control-room display, not a marketing site.

Design language: ISA-101-style high-performance HMI, refined for 2026 — a well-designed factory SCADA screen, not a beige 1980s panel and not a gamer RGB setup.

## Core rules

- **Color is state, never decoration.** Neutral graphite surfaces; the only saturated colors are green (running), oxide red (down), amber/yellow (hold / handoff / accent), grey (idle). Glow appears only on live states.
- **Hierarchy by typography, not color.** Primary data (status, WO progress, qty) is large and bright; secondary data (timestamps, reason codes, OEE factors) is small and dim.
- **Monospace for all data.** Asset codes, quantities, timestamps, OEE — readable at a glance from a few feet away (`Cascadia Mono` / `JetBrains Mono` / `Consolas` stack).
- Dense layout, hairline borders, stamp-like IDs (`WO-26-0841`, `M-PRESS-01`)
- Status rails: each tile/card carries a thin left edge in its state color
- Persistent chrome: facility name + plant code, shift clock, ingest health (LINK), handoff state (SHIFT)

## Still forbidden

- Purple gradients, glass cards, blob meshes, stock "smart factory" photos
- Inter-on-everything marketing heroes, generic SaaS dashboard chrome
- Bounce/spin animations; live state is a lamp, not a Lottie
- Invented 3D machines or neural-net wallpaper

Reference mix: modern control-room SCADA, ISA-101 high-performance HMI guidance, airport FIDS board. Instrument, not landing page.
