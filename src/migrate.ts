import { applyMigrations } from "./schema.js";
import { pool } from "./db.js";

async function main() {
  await applyMigrations(pool);
  process.stdout.write(`applied sql (${pool.kind})\n`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
