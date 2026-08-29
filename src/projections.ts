import type { SqlClient, SqlPool } from "./sql.js";

export async function assetIsPaused(client: SqlClient, assetId: string) {
  const lock = await client.query<{ run_event_id: string }>(
    `SELECT run_event_id FROM asset_locks WHERE asset_id = $1`,
    [assetId],
  );
  if (!lock.rowCount) return false;
  const paused = await client.query(
    `SELECT 1
     FROM floor_events s
     JOIN floor_events p
       ON p.asset_id = s.asset_id
      AND p.type = 'run.paused'
      AND p.occurred_at >= s.occurred_at
     WHERE s.event_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM floor_events r
         WHERE r.asset_id = p.asset_id
           AND r.type = 'run.resumed'
           AND r.occurred_at >= p.occurred_at
       )
     LIMIT 1`,
    [lock.rows[0].run_event_id],
  );
  return paused.rowCount > 0;
}

export async function pausedAssetIds(pool: SqlPool, plantId: string) {
  const { rows } = await pool.query<{ asset_id: string }>(
    `SELECT l.asset_id
     FROM asset_locks l
     JOIN assets a ON a.id = l.asset_id
     JOIN floor_events s ON s.event_id = l.run_event_id
     WHERE a.plant_id = $1
       AND EXISTS (
         SELECT 1 FROM floor_events p
         WHERE p.asset_id = l.asset_id
           AND p.type = 'run.paused'
           AND p.occurred_at >= s.occurred_at
           AND NOT EXISTS (
             SELECT 1 FROM floor_events r
             WHERE r.asset_id = p.asset_id
               AND r.type = 'run.resumed'
               AND r.occurred_at >= p.occurred_at
           )
       )`,
    [plantId],
  );
  return new Set(rows.map((r) => r.asset_id));
}

export async function rebuildAssetLocks(pool: SqlPool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM asset_locks");
    await client.query(`
      INSERT INTO asset_locks (asset_id, run_event_id, locked_by, locked_at)
      SELECT DISTINCT ON (e.asset_id)
        e.asset_id, e.event_id, e.actor_id, e.occurred_at
      FROM floor_events e
      WHERE e.type = 'run.started' AND e.asset_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM floor_events done
          WHERE done.asset_id = e.asset_id
            AND done.type IN ('run.completed')
            AND done.occurred_at >= e.occurred_at
        )
      ORDER BY e.asset_id, e.occurred_at DESC
    `);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
