import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  handleCreateAsset,
  handleCreateOperation,
  handleCreateReasonCode,
  handleCreateWorkOrder,
} from "./catalog-write.js";
import { handleStartRun, HttpError, type Actor } from "./commands.js";
import { applyMigrations } from "./schema.js";
import { seedPlant } from "./seed-plant.js";
import { createPoolFromUrl, type SqlClient, type SqlPool } from "./sql.js";

const planner: Actor = { userId: "U-PL-1", plantId: "PL-DEMO", role: "planner" };
const operator: Actor = { userId: "U-OP-1", plantId: "PL-DEMO", role: "operator" };

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

function statusOf(err: unknown) {
  if (err instanceof HttpError) return err.statusCode;
  throw err;
}

test("operator cannot write catalog", async () => {
  const db = await freshPlant();
  await assert.rejects(
    () => tx(db, (c) => handleCreateAsset(c, operator, { code: "X", name: "nope" })),
    (err: unknown) => statusOf(err) === 403,
  );
});

test("planner can add asset, reason, work order, operation", async () => {
  const db = await freshPlant();
  const asset = await tx(db, (c) =>
    handleCreateAsset(c, planner, { code: "PRESS-03", name: "Mechanical press 160T" }),
  );
  const reason = await tx(db, (c) =>
    handleCreateReasonCode(c, planner, { kind: "downtime", code: "WAIT-TOOL", label: "Waiting on tool" }),
  );
  const wo = await tx(db, (c) =>
    handleCreateWorkOrder(c, planner, { code: "WO-24-0999", targetQty: 80 }),
  );
  const op = await tx(db, (c) =>
    handleCreateOperation(c, planner, {
      workOrderId: wo.id,
      seq: 1,
      name: "Blank",
      defaultAssetId: asset.id,
    }),
  );
  assert.equal(asset.id, "PRESS-03");
  assert.ok(reason.id.includes("WAIT-TOOL"));
  const started = await tx(db, (c) =>
    handleStartRun(
      c,
      operator,
      { assetId: asset.id, workOrderId: wo.id, operationId: op.id },
      undefined,
    ),
  );
  assert.equal(started.replayed, false);
  const opened = await db.query(
    `SELECT 1 FROM floor_events WHERE type = 'work_order.opened' AND work_order_id = $1`,
    [wo.id],
  );
  assert.equal(opened.rowCount, 1);
});

test("duplicate asset code is 409", async () => {
  const db = await freshPlant();
  await assert.rejects(
    () => tx(db, (c) => handleCreateAsset(c, planner, { code: "PRESS-01", name: "dup" })),
    (err: unknown) => statusOf(err) === 409,
  );
});
