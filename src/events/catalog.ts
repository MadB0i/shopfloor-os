export const EVENT_TYPES = [
  "work_order.opened",
  "work_order.closed",
  "work_order.cancelled",
  "run.started",
  "run.paused",
  "run.resumed",
  "run.completed",
  "qty.good_recorded",
  "qty.scrap_recorded",
  "downtime.started",
  "downtime.ended",
  "handoff.submitted",
  "handoff.accepted",
  "handoff.overridden",
  "crew.clocked_in",
  "crew.clocked_out",
  "record.corrected",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const CURRENT_SCHEMA = 1;

export function isEventType(value: string): value is EventType {
  return (EVENT_TYPES as readonly string[]).includes(value);
}
