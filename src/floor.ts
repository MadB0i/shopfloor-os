import type { SqlPool } from "./db.js";

export async function loadFloor(pool: SqlPool, plantId: string) {
  const plant = await pool.query(`SELECT id, name FROM plants WHERE id = $1`, [plantId]);
  if (!plant.rowCount) return null;

  const assets = await pool.query(
    `SELECT a.id, a.code, a.name,
            l.run_event_id, l.locked_by, l.locked_at,
            s.work_order_id, s.operation_id
     FROM assets a
     LEFT JOIN asset_locks l ON l.asset_id = a.id
     LEFT JOIN floor_events s ON s.event_id = l.run_event_id
     WHERE a.plant_id = $1
     ORDER BY a.code`,
    [plantId],
  );

  const downtime = await pool.query(
    `SELECT DISTINCT ON (e.asset_id)
            e.asset_id, e.event_id, e.payload, e.occurred_at
     FROM floor_events e
     WHERE e.plant_id = $1 AND e.type = 'downtime.started'
       AND NOT EXISTS (
         SELECT 1 FROM floor_events e2
         WHERE e2.plant_id = $1 AND e2.asset_id = e.asset_id AND e2.type = 'downtime.ended'
           AND e2.occurred_at >= e.occurred_at
       )
     ORDER BY e.asset_id, e.occurred_at DESC`,
    [plantId],
  );
  const downByAsset = new Map(downtime.rows.map((r) => [r.asset_id, r]));

  const orders = await pool.query(
    `SELECT id, code, due_at, target_qty FROM work_orders WHERE plant_id = $1 ORDER BY code`,
    [plantId],
  );

  const reasons = await pool.query(
    `SELECT kind, code, label FROM reason_codes WHERE plant_id = $1 ORDER BY kind, code`,
    [plantId],
  );

  const ops = await pool.query(
    `SELECT o.id, o.work_order_id, o.seq, o.name, o.default_asset_id, w.code AS work_order_code
     FROM operations o
     JOIN work_orders w ON w.id = o.work_order_id
     WHERE w.plant_id = $1
     ORDER BY w.code, o.seq`,
    [plantId],
  );

  const tape = await pool.query(
    `SELECT event_id, type, actor_id, asset_id, work_order_id, payload, occurred_at
     FROM floor_events WHERE plant_id = $1
     ORDER BY recorded_at DESC, id DESC
     LIMIT 24`,
    [plantId],
  );

  return {
    plant: plant.rows[0],
    assets: assets.rows.map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      openRun: a.run_event_id
        ? {
            eventId: a.run_event_id,
            lockedBy: a.locked_by,
            lockedAt: a.locked_at,
            workOrderId: a.work_order_id,
            operationId: a.operation_id,
          }
        : null,
      openDowntime: downByAsset.get(a.id) ?? null,
    })),
    workOrders: orders.rows,
    operations: ops.rows,
    reasonCodes: reasons.rows,
    tape: tape.rows,
  };
}
