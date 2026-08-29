import { loadEnv } from "./env.js";
loadEnv();

import { pool } from "./db.js";

/**
 * Rebuild write-side projections from the event log.
 * Today that is asset_locks from unmatched run.started vs run.completed.
 */
async function main() {
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
    await pool.end();
  }
  process.stdout.write("rebuilt asset_locks from floor_events\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
