import type { SqlClient, SqlPool } from "./sql.js";
import { appendEvent } from "./events/store.js";

const plant = "PL-RIVERBEND";

async function insertCatalog(client: SqlClient) {
  await client.query(`INSERT INTO plants (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [
    plant,
    "Riverbend Stamping & Pack",
  ]);
  await client.query(
    `INSERT INTO users (id, display_name) VALUES
      ('U-OP-1', 'Rina Okafor (operator)'),
      ('U-SUP-1', 'Kamal Reyes (supervisor)'),
      ('U-PL-1', 'Meera Iyer (planner)'),
      ('U-AUD-1', 'Audit desk')
     ON CONFLICT DO NOTHING`,
  );
  await client.query(
    `INSERT INTO memberships (plant_id, user_id, role) VALUES
      ($1, 'U-OP-1', 'operator'),
      ($1, 'U-SUP-1', 'supervisor'),
      ($1, 'U-PL-1', 'planner'),
      ($1, 'U-AUD-1', 'auditor')
     ON CONFLICT DO NOTHING`,
    [plant],
  );
  await client.query(
    `INSERT INTO assets (id, plant_id, code, name) VALUES
      ('M-PRESS-01', $1, 'PRESS-01', 'Mechanical press 80T'),
      ('M-PRESS-02', $1, 'PRESS-02', 'Mechanical press 110T'),
      ('M-PACK-01', $1, 'PACK-01', 'Pack bench')
     ON CONFLICT DO NOTHING`,
    [plant],
  );
  await client.query(
    `INSERT INTO reason_codes (id, plant_id, kind, code, label) VALUES
      ('RC-D-WAIT-MAT', $1, 'downtime', 'WAIT-MATERIAL', 'Waiting on material'),
      ('RC-D-BREAK', $1, 'downtime', 'BREAKDOWN', 'Unplanned breakdown'),
      ('RC-D-CO', $1, 'downtime', 'CHANGEOVER', 'Tool / die changeover'),
      ('RC-S-DIM', $1, 'scrap', 'DIM-OOS', 'Dimension out of spec'),
      ('RC-S-SURF', $1, 'scrap', 'SURFACE', 'Surface defect')
     ON CONFLICT DO NOTHING`,
    [plant],
  );
  await client.query(
    `INSERT INTO work_orders (id, plant_id, code, due_at, target_qty) VALUES
      ('WO-26-0841', $1, 'WO-26-0841', now() + interval '3 days', 500)
     ON CONFLICT DO NOTHING`,
    [plant],
  );
  await client.query(
    `INSERT INTO operations (id, work_order_id, seq, name, default_asset_id) VALUES
      ('OP-0841-1', 'WO-26-0841', 1, 'Blank', 'M-PRESS-01'),
      ('OP-0841-2', 'WO-26-0841', 2, 'Form', 'M-PRESS-02'),
      ('OP-0841-3', 'WO-26-0841', 3, 'Pack', 'M-PACK-01')
     ON CONFLICT DO NOTHING`,
  );
  await client.query(
    `INSERT INTO shifts (id, plant_id, code, name, starts_at, ends_at) VALUES
      ('SHIFT-A', $1, 'A', 'Morning', '06:00', '14:00'),
      ('SHIFT-B', $1, 'B', 'Afternoon', '14:00', '22:00'),
      ('SHIFT-C', $1, 'C', 'Night', '22:00', '06:00')
     ON CONFLICT DO NOTHING`,
    [plant],
  );
}

async function insertDemoEvents(client: SqlClient) {
  const existing = await client.query<{ cnt: string }>(
    `SELECT count(*)::text AS cnt FROM floor_events WHERE plant_id = $1`,
    [plant],
  );
  if (Number(existing.rows[0].cnt) > 0) return;

  const t = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000);

  // ── M-PRESS-01: active run on WO-26-0841 / OP-0841-1 ──

  const run1 = await appendEvent(client, {
    eventId: "seed-run-press01",
    plantId: plant,
    type: "run.started",
    actorId: "U-OP-1",
    assetId: "M-PRESS-01",
    workOrderId: "WO-26-0841",
    operationId: "OP-0841-1",
    occurredAt: t(120),
  });
  await client.query(
    `INSERT INTO asset_locks (asset_id, run_event_id, locked_by, locked_at)
     VALUES ('M-PRESS-01', $1, 'U-OP-1', $2)`,
    [run1, t(120)],
  );

  await appendEvent(client, {
    plantId: plant,
    type: "qty.good_recorded",
    actorId: "U-OP-1",
    assetId: "M-PRESS-01",
    workOrderId: "WO-26-0841",
    operationId: "OP-0841-1",
    payload: { qty: 50 },
    occurredAt: t(110),
  });

  await appendEvent(client, {
    plantId: plant,
    type: "qty.good_recorded",
    actorId: "U-OP-1",
    assetId: "M-PRESS-01",
    workOrderId: "WO-26-0841",
    operationId: "OP-0841-1",
    payload: { qty: 30 },
    occurredAt: t(80),
  });

  const scrapEvt = await appendEvent(client, {
    plantId: plant,
    type: "qty.scrap_recorded",
    actorId: "U-OP-1",
    assetId: "M-PRESS-01",
    workOrderId: "WO-26-0841",
    operationId: "OP-0841-1",
    payload: { qty: 3, reasonCode: "DIM-OOS" },
    occurredAt: t(60),
  });

  await appendEvent(client, {
    plantId: plant,
    type: "record.corrected",
    actorId: "U-SUP-1",
    assetId: "M-PRESS-01",
    workOrderId: "WO-26-0841",
    operationId: "OP-0841-1",
    payload: { replacesEventId: scrapEvt, reason: "Miscount — supervisor verified 1 scrap, not 3" },
    occurredAt: t(50),
  });

  await appendEvent(client, {
    plantId: plant,
    type: "qty.good_recorded",
    actorId: "U-OP-1",
    assetId: "M-PRESS-01",
    workOrderId: "WO-26-0841",
    operationId: "OP-0841-1",
    payload: { qty: 20 },
    occurredAt: t(15),
  });

  // ── M-PRESS-02: completed run + open downtime ──

  const run2 = await appendEvent(client, {
    plantId: plant,
    type: "run.started",
    actorId: "U-OP-1",
    assetId: "M-PRESS-02",
    workOrderId: "WO-26-0841",
    operationId: "OP-0841-2",
    occurredAt: t(300),
  });

  await appendEvent(client, {
    plantId: plant,
    type: "run.completed",
    actorId: "U-OP-1",
    assetId: "M-PRESS-02",
    workOrderId: "WO-26-0841",
    operationId: "OP-0841-2",
    payload: { startedEventId: run2 },
    occurredAt: t(240),
  });

  await appendEvent(client, {
    plantId: plant,
    type: "downtime.started",
    actorId: "U-OP-1",
    assetId: "M-PRESS-02",
    payload: { reasonCode: "WAIT-MATERIAL" },
    occurredAt: t(230),
  });

  // ── Handoff: submitted (pending gate — blocks run.start) ──

  await appendEvent(client, {
    plantId: plant,
    type: "handoff.submitted",
    actorId: "U-OP-1",
    payload: {
      fromShift: "A",
      toShift: "B",
      note: "Press 02 down waiting on blanks. Press 01 running WO-26-0841.",
      openRuns: [{ assetId: "M-PRESS-01", workOrderId: "WO-26-0841" }],
      openDowntime: [{ assetId: "M-PRESS-02", reasonCode: "WAIT-MATERIAL" }],
    },
    occurredAt: t(30),
  });
}

export async function seedPlant(pool: SqlPool, opts?: { skipEvents?: boolean }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await insertCatalog(client);
    if (!opts?.skipEvents) await insertDemoEvents(client);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
