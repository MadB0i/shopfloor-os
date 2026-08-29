import { pool } from "./db.js";
import { seedPlant } from "./seed-plant.js";

async function main() {
  await seedPlant(pool);
  process.stdout.write("seeded PL-DEMO\n");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
