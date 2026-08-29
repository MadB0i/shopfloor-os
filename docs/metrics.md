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

**OEE**  
availability × performance × quality when all three are defined.

These formulas ship before the metrics API so nobody “tweaks the dashboard.”
