# OEE-lite

Numbers come from events in a shift window `[start, end)` for one asset. If a field is missing, the metric is omitted, not invented.

**Availability**  
`uptime / planned`  
planned = shift length minus planned stops (reason code class `CHANGEOVER` may be tagged planned in a later catalog flag; today CHANGEOVER counts as downtime like the rest).  
uptime = planned − duration of `downtime.started`…`downtime.ended` pairs that overlap the window.

**Performance**  
`good_qty / target_qty`  
target from `work_orders.target_qty` allocated to the asset’s operations in that window (v1: use WO target only if a single WO ran; otherwise unknown).

**Quality**  
`good / (good + scrap)`  
good = sum of `qty.good_recorded.payload.qty`  
scrap = sum of `qty.scrap_recorded.payload.qty`

**Corrections (B4)**  
A `record.corrected` row never updates or deletes the event it names. That original row stays on the tape.  
Qty (and later OEE) **must ignore** any event whose `event_id` appears as `payload.replacesEventId` on a `record.corrected` in the same plant (`src/effective.ts`).  

To change a count, void the bad qty event, then append a new `qty.*` with the right number. Two corrections on the same `event_id` are rejected. Only `qty.good_recorded` and `qty.scrap_recorded` are correctable — run/lock events are not, so the lock projection cannot silently lie.

**OEE**  
availability × performance × quality when all three are defined.

These formulas ship before the metrics API so nobody “tweaks the dashboard.”

**API (B5)**  
`GET /v1/metrics/oee?from=&to=&asset=` — window is `[from, to)`. `asset` optional (all plant assets). Missing factors are JSON `null`. Quality uses `effectiveQtySum` (corrections). Performance is null unless exactly one work order has `run.started` on that asset in the window.
