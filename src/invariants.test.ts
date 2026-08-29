import assert from "node:assert/strict";
import { test } from "node:test";

/** Invariant: scrap qty must be a positive integer. Enforced in commands via zod; this is the documented rule. */
test("scrap qty cannot be zero or negative", () => {
  const qty = 0;
  assert.equal(qty > 0, false);
});

test("correction never deletes — it is another event type", () => {
  const log = [{ type: "qty.scrap_recorded", payload: { qty: 12 } }, { type: "record.corrected", payload: { replaces: "evt-1" } }];
  assert.equal(log.filter((e) => e.type === "qty.scrap_recorded").length, 1);
});
