import pg from "pg";
import { loadEnv } from "./env.js";

loadEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env");
}

export const pool = new pg.Pool({ connectionString: url });
