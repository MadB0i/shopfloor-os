import { pool } from "./db.js";
import { rebuildAssetLocks } from "./projections.js";

async function main() {
  await rebuildAssetLocks(pool);
  process.stdout.write("rebuilt asset_locks from floor_events\n");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
