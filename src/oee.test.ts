import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { appendEvent } from "./events/store.js";
import { computeAssetOee } from "./oee.js";
import { applyMigrations } from "./schema.js";
import { seedPlant } from "./seed-plant.js";
import { createPoolFromUrl, type SqlClient, type SqlPool } from "./sql.js";

let pool: SqlPool | undefined;

afterEach(async () => {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
});

async function freshPlant() {
  pool = createPoolFromUrl("pglite:memory");
  await applyMigrations(pool);
  await seedPlant(pool);
  return pool;
}

async function tx<T>(db: SqlPool, fn: (client: SqlClient) => Promise<T>) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

const from = new Date("2026-08-30T10:00:00.000Z");
const to = new Date("2026-08-30T11:00:00.000Z");

test("empty window: availability 1, performance and quality omitted", async () => {
  const db = await freshPlant();
  const score = await computeAssetOee(db, "PL-DEMO", "M-PRESS-01", from, to);
  assert.equal(score.availability, 1);
  assert.equal(score.performance, null);
  assert.equal(score.quality, null);
  assert.equal(score.oee, null);
});

test("15 minutes downtime in a 60 minute window is availability 0.75", async () => {
  const db = await freshPlant();
  await tx(db, async (c) => {
    await appendEvent(c, {
      plantId: "PL-DEMO",
      type: "downtime.started",
      actorId: "U-OP-1",
      assetId: "M-PRESS-01",
      occurredAt: new Date("2026-08-30T10:00:00.000Z"),
      payload: { reasonCode: "BREAKDOWN" },
    });
    await appendEvent(c, {
      plantId: "PL-DEMO",
      type: "downtime.ended",
      actorId: "U-OP-1",
      assetId: "M-PRESS-01",
      occurredAt: new Date("2026-08-30T10:15:00.000Z"),
      payload: {},
    });
  });
  const score = await computeAssetOee(db, "PL-DEMO", "M-PRESS-01", from, to);
  assert.equal(score.availability, 0.75);
  assert.equal(score.parts.downtimeMs, 15 * 60 * 1000);
});

test("quality uses effective qty; voided scrap is ignored", async () => {
  const db = await freshPlant();
  await tx(db, async (c) => {
    const scrapId = await appendEvent(c, {
      plantId: "PL-DEMO",
      type: "qty.scrap_recorded",
      actorId: "U-OP-1",
      assetId: "M-PRESS-01",
      workOrderId: "WO-24-0841",
      operationId: "OP-0841-1",
      occurredAt: new Date("2026-08-30T10:20:00.000Z"),
      payload: { qty: 2, reasonCode: "DIM-OOS" },
    });
    await appendEvent(c, {
      plantId: "PL-DEMO",
      type: "qty.good_recorded",
      actorId: "U-OP-1",
      assetId: "M-PRESS-01",
      workOrderId: "WO-24-0841",
      operationId: "OP-0841-1",
      occurredAt: new Date("2026-08-30T10:21:00.000Z"),
      payload: { qty: 8 },
    });
    await appendEvent(c, {
      plantId: "PL-DEMO",
      type: "record.corrected",
      actorId: "U-OP-1",
      assetId: "M-PRESS-01",
      workOrderId: "WO-24-0841",
      operationId: "OP-0841-1",
      occurredAt: new Date("2026-08-30T10:22:00.000Z"),
      payload: { replacesEventId: scrapId, reason: "miscount" },
    });
  });
  const score = await computeAssetOee(db, "PL-DEMO", "M-PRESS-01", from, to);
  assert.equal(score.quality, 1);
  assert.equal(score.parts.good, 8);
  assert.equal(score.parts.scrap, 0);
});

test("performance is good/target only when a single WO ran on the asset", async () => {
  const db = await freshPlant();
  await tx(db, async (c) => {
    await appendEvent(c, {
      plantId: "PL-DEMO",
      type: "run.started",
      actorId: "U-OP-1",
      assetId: "M-PRESS-01",
      workOrderId: "WO-24-0841",
      operationId: "OP-0841-1",
      occurredAt: new Date("2026-08-30T10:05:00.000Z"),
      payload: {},
    });
    await appendEvent(c, {
      plantId: "PL-DEMO",
      type: "qty.good_recorded",
      actorId: "U-OP-1",
      assetId: "M-PRESS-01",
      workOrderId: "WO-24-0841",
      operationId: "OP-0841-1",
      occurredAt: new Date("2026-08-30T10:30:00.000Z"),
      payload: { qty: 50 },
    });
  });
  const score = await computeAssetOee(db, "PL-DEMO", "M-PRESS-01", from, to);
  assert.equal(score.parts.targetQty, 500);
  assert.equal(score.performance, 0.1);
  assert.equal(score.quality, 1);
  assert.equal(score.availability, 1);
  assert.equal(score.oee, 0.1);
});
