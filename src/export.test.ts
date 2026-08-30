import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { csvField, eventsToCsv } from "./csv.js";
import { appendEvent } from "./events/store.js";
import { applyMigrations } from "./schema.js";
import { seedPlant } from "./seed-plant.js";
import { createPoolFromUrl, type SqlClient, type SqlPool } from "./sql.js";
import { loadTape } from "./tape.js";

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
  await seedPlant(pool, { skipEvents: true });
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

test("csvField quotes commas and doubles quotes", () => {
  assert.equal(csvField("a,b"), '"a,b"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
});

test("csv export keeps voided qty rows and the correction", async () => {
  const db = await freshPlant();
  let scrapId = "";
  await tx(db, async (c) => {
    scrapId = await appendEvent(c, {
      plantId: "PL-RIVERBEND",
      type: "qty.scrap_recorded",
      actorId: "U-OP-1",
      assetId: "M-PRESS-01",
      workOrderId: "WO-26-0841",
      operationId: "OP-0841-1",
      payload: { qty: 4, reasonCode: "DIM-OOS" },
    });
    await appendEvent(c, {
      plantId: "PL-RIVERBEND",
      type: "record.corrected",
      actorId: "U-OP-1",
      assetId: "M-PRESS-01",
      workOrderId: "WO-26-0841",
      operationId: "OP-0841-1",
      payload: { replacesEventId: scrapId, reason: "miscount" },
    });
  });
  const rows = await loadTape(db, "PL-RIVERBEND");
  const csv = eventsToCsv(rows);
  assert.match(csv, /^event_id,type,schema_version,/);
  assert.match(csv, /qty\.scrap_recorded/);
  assert.match(csv, /record\.corrected/);
  const scrapLine = csv.split(/\r?\n/).find((line) => line.startsWith(`${scrapId},`));
  assert.ok(scrapLine?.endsWith(",true") || scrapLine?.includes(",true\r"));
});
