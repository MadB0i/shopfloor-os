import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";
import { loadEnv } from "./env.js";

loadEnv();

export type QueryResult<T = Record<string, unknown>> = {
  rows: T[];
  rowCount: number;
};

export type SqlClient = {
  query: <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<QueryResult<T>>;
  release: () => void;
};

export type SqlPool = {
  query: <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<QueryResult<T>>;
  connect: () => Promise<SqlClient>;
  end: () => Promise<void>;
  kind: "postgres" | "pglite";
};

function normalize(result: { rows?: unknown[]; affectedRows?: number }): QueryResult {
  const rows = (result.rows ?? []) as Record<string, unknown>[];
  const rowCount = rows.length > 0 ? rows.length : (result.affectedRows ?? 0);
  return { rows, rowCount };
}

function pglitePool(dataDir: string): SqlPool {
  const db = new PGlite(dataDir);
  let mutex = Promise.resolve();

  const lock = async () => {
    await db.waitReady;
    let unlock: () => void = () => {};
    const next = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const prev = mutex;
    mutex = prev.then(() => next);
    await prev;
    return unlock;
  };

  return {
    kind: "pglite",
    async query(text, params) {
      const unlock = await lock();
      try {
        return normalize(await db.query(text, params ?? []));
      } finally {
        unlock();
      }
    },
    async connect() {
      const unlock = await lock();
      return {
        async query(text, params) {
          return normalize(await db.query(text, params ?? []));
        },
        release() {
          unlock();
        },
      };
    },
    async end() {
      const unlock = await lock();
      try {
        await db.close();
      } finally {
        unlock();
      }
    },
  };
}

function postgresPool(connectionString: string): SqlPool {
  const inner = new pg.Pool({ connectionString });
  return {
    kind: "postgres",
    async query(text, params) {
      const r = await inner.query(text, params);
      return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
    },
    async connect() {
      const c = await inner.connect();
      return {
        async query(text, params) {
          const r = await c.query(text, params);
          return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
        },
        release() {
          c.release();
        },
      };
    },
    async end() {
      await inner.end();
    },
  };
}

function createPool(): SqlPool {
  const url = process.env.DATABASE_URL ?? "pglite:./data/shopfloor";
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    return postgresPool(url);
  }
  if (url.startsWith("pglite:")) {
    const dir = path.resolve(url.slice("pglite:".length).trim() || "./data/shopfloor");
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    return pglitePool(dir);
  }
  throw new Error("DATABASE_URL must be postgres://... or pglite:./data/shopfloor");
}

export const pool = createPool();
