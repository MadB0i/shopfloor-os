import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SqlPool } from "./sql.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "sql");

export function sqlStatements(sql: string) {
  return sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.split("\n").every((line) => line.trim().startsWith("--")));
}

export async function applyMigrations(pool: SqlPool) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    for (const stmt of sqlStatements(sql)) {
      await pool.query(stmt);
    }
  }
}
