import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "sql");

async function main() {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    await pool.query(sql);
    process.stdout.write(`applied ${file}\n`);
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
