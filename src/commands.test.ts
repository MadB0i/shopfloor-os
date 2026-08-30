import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { canReadFullTape } from "./auth.js";
import { handleCompleteRun, handleCorrect, handleGood, handleHandoffAccept, handleHandoffOverride, handleHandoffSubmit, handlePauseRun, handleResumeRun, handleScrap, handleStartRun, HttpError, type Actor } from "./commands.js";
import { loadTape } from "./tape.js";
import { effectiveQtySum } from "./effective.js";
import { loadFloor } from "./floor.js";
import { rebuildAssetLocks } from "./projections.js";
import { applyMigrations } from "./schema.js";
import { seedPlant } from "./seed-plant.js";
import { createPoolFromUrl, type SqlClient, type SqlPool } from "./sql.js";

const operator: Actor = { userId: "U-OP-1", plantId: "PL-DEMO", role: "operator" };
const supervisor: Actor = { userId: "U-SUP-1", plantId: "PL-DEMO", role: "supervisor" };
const auditor: Actor = { userId: "U-AUD-1", plantId: "PL-DEMO", role: "auditor" };

const startBody = {
  assetId: "M-PRESS-01",
  workOrderId: "WO-24-0841",
  operationId: "OP-0841-1",
};

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

function statusOf(err: unknown) {
  if (err instanceof HttpError) return err.statusCode;
  throw err;
}

test("second start on the same asset is 409", async () => {
  const db = await freshPlant();
  await tx(db, (c) => handleStartRun(c, operator, startBody, undefined));
  await assert.rejects(
    () => tx(db, (c) => handleStartRun(c, operator, startBody, undefined)),
    (err: unknown) => statusOf(err) === 409,
  );
});

test("unknown scrap reason is 400", async () => {
  const db = await freshPlant();
  await assert.rejects(
    () =>
      tx(db, (c) =>
        handleScrap(
          c,
          operator,
          { ...startBody, qty: 1, reasonCode: "NOT-A-CODE" },
          undefined,
        ),
      ),
    (err: unknown) => statusOf(err) === 400,
  );
});

test("auditor cannot write", async () => {
  const db = await freshPlant();
  await assert.rejects(
    () => tx(db, (c) => handleStartRun(c, auditor, startBody, undefined)),
    (err: unknown) => statusOf(err) === 403,
  );
});

test("idempotent replay returns the same event id", async () => {
  const db = await freshPlant();
  const first = await tx(db, (c) => handleStartRun(c, operator, startBody, "key-1"));
  const second = await tx(db, (c) => handleStartRun(c, operator, startBody, "key-1"));
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(second.eventId, first.eventId);
});

test("idempotency key reused with a different body is 409", async () => {
  const db = await freshPlant();
  await tx(db, (c) => handleStartRun(c, operator, startBody, "key-2"));
  await assert.rejects(
    () =>
      tx(db, (c) =>
        handleStartRun(
          c,
          operator,
          { ...startBody, assetId: "M-PRESS-02" },
          "key-2",
        ),
      ),
    (err: unknown) => statusOf(err) === 409,
  );
});

test("rebuild restores the asset lock from the event log", async () => {
  const db = await freshPlant();
  const started = await tx(db, (c) => handleStartRun(c, operator, startBody, undefined));
  await db.query("DELETE FROM asset_locks");
  const gone = await db.query(`SELECT 1 FROM asset_locks WHERE asset_id = $1`, ["M-PRESS-01"]);
  assert.equal(gone.rowCount, 0);
  await rebuildAssetLocks(db);
  const back = await db.query(
    `SELECT run_event_id FROM asset_locks WHERE asset_id = $1`,
    ["M-PRESS-01"],
  );
  assert.equal(back.rowCount, 1);
  assert.equal(back.rows[0]?.run_event_id, started.eventId);
});

test("skip-ahead run.start is 409 until the previous operation is complete", async () => {
  const db = await freshPlant();
  await assert.rejects(
    () =>
      tx(db, (c) =>
        handleStartRun(
          c,
          operator,
          {
            assetId: "M-PRESS-02",
            workOrderId: "WO-24-0841",
            operationId: "OP-0841-2",
          },
          undefined,
        ),
      ),
    (err: unknown) => {
      assert.equal(statusOf(err), 409);
      assert.match((err as Error).message, /previous operation is not complete/);
      return true;
    },
  );
});

test("unknown operation on run.start is 400", async () => {
  const db = await freshPlant();
  await assert.rejects(
    () =>
      tx(db, (c) =>
        handleStartRun(
          c,
          operator,
          { ...startBody, operationId: "OP-NOPE" },
          undefined,
        ),
      ),
    (err: unknown) => statusOf(err) === 400,
  );
});

test("seq 2 can start after seq 1 is completed", async () => {
  const db = await freshPlant();
  await tx(db, (c) => handleStartRun(c, operator, startBody, undefined));
  await tx(db, (c) => handleCompleteRun(c, operator, { assetId: "M-PRESS-01" }, undefined));
  const next = await tx(db, (c) =>
    handleStartRun(
      c,
      operator,
      {
        assetId: "M-PRESS-02",
        workOrderId: "WO-24-0841",
        operationId: "OP-0841-2",
      },
      undefined,
    ),
  );
  assert.equal(next.replayed, false);
});

test("pause without an open run is 409", async () => {
  const db = await freshPlant();
  await assert.rejects(
    () => tx(db, (c) => handlePauseRun(c, operator, { assetId: "M-PRESS-01" }, undefined)),
    (err: unknown) => statusOf(err) === 409,
  );
});

test("pause keeps the lock; resume clears paused; complete still works from hold", async () => {
  const db = await freshPlant();
  await tx(db, (c) => handleStartRun(c, operator, startBody, undefined));
  await tx(db, (c) => handlePauseRun(c, operator, { assetId: "M-PRESS-01" }, undefined));
  const held = await loadFloor(db, "PL-DEMO");
  const press = held?.assets.find((a) => a.id === "M-PRESS-01");
  assert.equal(press?.openRun?.paused, true);
  await assert.rejects(
    () => tx(db, (c) => handlePauseRun(c, operator, { assetId: "M-PRESS-01" }, undefined)),
    (err: unknown) => statusOf(err) === 409,
  );
  await tx(db, (c) => handleResumeRun(c, operator, { assetId: "M-PRESS-01" }, undefined));
  const going = await loadFloor(db, "PL-DEMO");
  assert.equal(going?.assets.find((a) => a.id === "M-PRESS-01")?.openRun?.paused, false);
  await tx(db, (c) => handlePauseRun(c, operator, { assetId: "M-PRESS-01" }, undefined));
  const done = await tx(db, (c) => handleCompleteRun(c, operator, { assetId: "M-PRESS-01" }, undefined));
  assert.equal(done.replayed, false);
  const idle = await loadFloor(db, "PL-DEMO");
  assert.equal(idle?.assets.find((a) => a.id === "M-PRESS-01")?.openRun, null);
});

test("resume without pause is 409", async () => {
  const db = await freshPlant();
  await tx(db, (c) => handleStartRun(c, operator, startBody, undefined));
  await assert.rejects(
    () => tx(db, (c) => handleResumeRun(c, operator, { assetId: "M-PRESS-01" }, undefined)),
    (err: unknown) => statusOf(err) === 409,
  );
});

test("correction voids qty for totals without deleting the original row", async () => {
  const db = await freshPlant();
  await tx(db, (c) => handleStartRun(c, operator, startBody, undefined));
  const scrap = await tx(db, (c) =>
    handleScrap(c, operator, { ...startBody, qty: 12, reasonCode: "DIM-OOS" }, undefined),
  );
  assert.equal(await effectiveQtySum(db, "PL-DEMO", "qty.scrap_recorded"), 12);
  await tx(db, (c) =>
    handleCorrect(c, operator, { replacesEventId: scrap.eventId, reason: "miscount" }, undefined),
  );
  const still = await db.query(`SELECT 1 FROM floor_events WHERE event_id = $1`, [scrap.eventId]);
  assert.equal(still.rowCount, 1);
  assert.equal(await effectiveQtySum(db, "PL-DEMO", "qty.scrap_recorded"), 0);
  await assert.rejects(
    () =>
      tx(db, (c) =>
        handleCorrect(c, operator, { replacesEventId: scrap.eventId, reason: "again" }, undefined),
      ),
    (err: unknown) => statusOf(err) === 409,
  );
});

test("cannot correct a run.started event", async () => {
  const db = await freshPlant();
  const started = await tx(db, (c) => handleStartRun(c, operator, startBody, undefined));
  await assert.rejects(
    () =>
      tx(db, (c) =>
        handleCorrect(c, operator, { replacesEventId: started.eventId, reason: "oops" }, undefined),
      ),
    (err: unknown) => statusOf(err) === 400,
  );
});

test("auditor cannot write a correction", async () => {
  const db = await freshPlant();
  await assert.rejects(
    () =>
      tx(db, (c) =>
        handleCorrect(c, auditor, { replacesEventId: "evt-x", reason: "no" }, undefined),
      ),
    (err: unknown) => statusOf(err) === 403,
  );
});

test("full tape is auditor-only", () => {
  assert.equal(canReadFullTape("auditor"), true);
  assert.equal(canReadFullTape("operator"), false);
  assert.equal(canReadFullTape("supervisor"), false);
  assert.equal(canReadFullTape("planner"), false);
});

test("good qty is counted; tape marks voided scrap", async () => {
  const db = await freshPlant();
  await tx(db, (c) => handleStartRun(c, operator, startBody, undefined));
  await tx(db, (c) => handleGood(c, operator, { ...startBody, qty: 8 }, undefined));
  const scrap = await tx(db, (c) =>
    handleScrap(c, operator, { ...startBody, qty: 3, reasonCode: "DIM-OOS" }, undefined),
  );
  await tx(db, (c) =>
    handleCorrect(c, operator, { replacesEventId: scrap.eventId, reason: "miscount" }, undefined),
  );
  assert.equal(await effectiveQtySum(db, "PL-DEMO", "qty.good_recorded"), 8);
  const tape = await loadTape(db, "PL-DEMO");
  const voided = tape.find((e) => e.event_id === scrap.eventId);
  assert.equal(voided?.voided, true);
  const future = await loadTape(db, "PL-DEMO", new Date("2099-01-01T00:00:00Z"));
  assert.equal(future.length, 0);
});

test("unknown event cannot be corrected", async () => {
  const db = await freshPlant();
  await assert.rejects(
    () =>
      tx(db, (c) =>
        handleCorrect(c, operator, { replacesEventId: "no-such-event", reason: "x" }, undefined),
      ),
    (err: unknown) => statusOf(err) === 400,
  );
});

const shifts = { fromShift: "A", toShift: "B" };

test("pending handoff blocks run.start until accept", async () => {
  const db = await freshPlant();
  await tx(db, (c) => handleHandoffSubmit(c, operator, { ...shifts, note: "eod" }, undefined));
  const floor = await loadFloor(db, "PL-DEMO");
  assert.equal(floor?.handoff.pending, true);
  await assert.rejects(
    () => tx(db, (c) => handleStartRun(c, operator, startBody, undefined)),
    (err: unknown) => statusOf(err) === 409,
  );
  await tx(db, (c) => handleHandoffAccept(c, supervisor, shifts, undefined));
  const started = await tx(db, (c) => handleStartRun(c, operator, startBody, undefined));
  assert.equal(started.replayed, false);
});

test("supervisor override also clears the handoff gate", async () => {
  const db = await freshPlant();
  await tx(db, (c) => handleHandoffSubmit(c, operator, shifts, undefined));
  await assert.rejects(
    () => tx(db, (c) => handleHandoffOverride(c, operator, { ...shifts, reason: "busy" }, undefined)),
    (err: unknown) => statusOf(err) === 403,
  );
  await tx(db, (c) => handleHandoffOverride(c, supervisor, { ...shifts, reason: "cover" }, undefined));
  const started = await tx(db, (c) => handleStartRun(c, operator, startBody, undefined));
  assert.equal(started.replayed, false);
});
