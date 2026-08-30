import assert from "node:assert/strict";
import { test } from "node:test";
import { CURRENT_SCHEMA, EVENT_TYPES, isEventType } from "./catalog.js";

test("catalog is a closed list", () => {
  assert.equal(CURRENT_SCHEMA, 1);
  assert.ok(EVENT_TYPES.includes("run.started"));
  assert.ok(EVENT_TYPES.includes("handoff.overridden"));
  assert.equal(isEventType("run.started"), true);
  assert.equal(isEventType("Run.Started"), false);
  assert.equal(isEventType("ai.predict"), false);
});
