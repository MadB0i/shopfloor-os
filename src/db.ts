import { loadEnv } from "./env.js";
import { createPoolFromUrl } from "./sql.js";

loadEnv();

export type { QueryResult, SqlClient, SqlPool } from "./sql.js";
export { createPoolFromUrl } from "./sql.js";

export const pool = createPoolFromUrl(process.env.DATABASE_URL ?? "pglite:./data/shopfloor");
