import type { SqlPool } from "./sql.js";

export async function loadTape(
  pool: SqlPool,
  plantId: string,
  from?: Date,
  to?: Date,
) {
  const params: unknown[] = [plantId];
  let where = `plant_id = $1`;
  if (from) {
    params.push(from.toISOString());
    where += ` AND occurred_at >= $${params.length}`;
  }
  if (to) {
    params.push(to.toISOString());
    where += ` AND occurred_at < $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT event_id, type, schema_version, actor_id, asset_id, work_order_id, operation_id, payload, occurred_at, recorded_at
     FROM floor_events
     WHERE ${where}
     ORDER BY recorded_at ASC, id ASC
     LIMIT 2000`,
    params,
  );
  return rows;
}
