import Fastify from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import { actorFromHeader, tokensFromEnv } from "./auth.js";
import { handleDowntimeStart, handleScrap, handleStartRun } from "./commands.js";
import { pool } from "./db.js";
import { isEventType } from "./events/catalog.js";

const tokens = tokensFromEnv();

function statusOf(err: unknown): number {
  if (err && typeof err === "object" && "statusCode" in err && typeof err.statusCode === "number") {
    return err.statusCode;
  }
  if (err instanceof ZodError) return 400;
  return 500;
}

async function build() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  app.get("/health", async () => ({ ok: true }));

  app.addHook("preHandler", async (req, reply) => {
    if (req.url === "/health") return;
    const actor = actorFromHeader(req.headers.authorization, tokens);
    if (!actor) {
      reply.code(401).send({ error: "missing or unknown bearer token" });
      return;
    }
    (req as typeof req & { actor: typeof actor }).actor = actor;
  });

  app.post("/v1/commands/run.start", async (req, reply) => {
    const actor = (req as typeof req & { actor: NonNullable<ReturnType<typeof actorFromHeader>> }).actor;
    const key = req.headers["idempotency-key"];
    const idem = typeof key === "string" ? key : undefined;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await handleStartRun(client, actor, req.body, idem);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      reply.code(statusOf(err));
      return { error: err instanceof Error ? err.message : "failed" };
    } finally {
      client.release();
    }
  });

  app.post("/v1/commands/qty.scrap", async (req, reply) => {
    const actor = (req as typeof req & { actor: NonNullable<ReturnType<typeof actorFromHeader>> }).actor;
    const key = req.headers["idempotency-key"];
    const idem = typeof key === "string" ? key : undefined;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await handleScrap(client, actor, req.body, idem);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      reply.code(statusOf(err));
      return { error: err instanceof Error ? err.message : "failed" };
    } finally {
      client.release();
    }
  });

  app.post("/v1/commands/downtime.start", async (req, reply) => {
    const actor = (req as typeof req & { actor: NonNullable<ReturnType<typeof actorFromHeader>> }).actor;
    const key = req.headers["idempotency-key"];
    const idem = typeof key === "string" ? key : undefined;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await handleDowntimeStart(client, actor, req.body, idem);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      reply.code(statusOf(err));
      return { error: err instanceof Error ? err.message : "failed" };
    } finally {
      client.release();
    }
  });

  app.get("/v1/plants/:plantId/assets/:assetId/live", async (req, reply) => {
    const actor = (req as typeof req & { actor: NonNullable<ReturnType<typeof actorFromHeader>> }).actor;
    const { plantId, assetId } = req.params as { plantId: string; assetId: string };
    if (plantId !== actor.plantId) {
      reply.code(403);
      return { error: "plant mismatch" };
    }
    const lock = await pool.query(
      `SELECT run_event_id, locked_by, locked_at FROM asset_locks WHERE asset_id = $1`,
      [assetId],
    );
    const down = await pool.query(
      `SELECT event_id, payload, occurred_at FROM floor_events
       WHERE plant_id = $1 AND asset_id = $2 AND type = 'downtime.started'
       AND NOT EXISTS (
         SELECT 1 FROM floor_events e2
         WHERE e2.plant_id = $1 AND e2.asset_id = $2 AND e2.type = 'downtime.ended'
           AND e2.occurred_at >= floor_events.occurred_at
       )
       ORDER BY occurred_at DESC LIMIT 1`,
      [plantId, assetId],
    );
    return {
      assetId,
      openRun: lock.rows[0] ?? null,
      openDowntime: down.rows[0] ?? null,
    };
  });

  app.get("/v1/work-orders/:id/timeline", async (req, reply) => {
    const actor = (req as typeof req & { actor: NonNullable<ReturnType<typeof actorFromHeader>> }).actor;
    const { id } = req.params as { id: string };
    const { rows } = await pool.query(
      `SELECT event_id, type, schema_version, actor_id, asset_id, operation_id, payload, occurred_at, recorded_at
       FROM floor_events WHERE plant_id = $1 AND work_order_id = $2
       ORDER BY recorded_at ASC, id ASC`,
      [actor.plantId, id],
    );
    for (const row of rows) {
      if (!isEventType(row.type)) {
        reply.code(500);
        return { error: `corrupt event type ${row.type}` };
      }
    }
    return { workOrderId: id, events: rows };
  });

  return app;
}

const app = await build();
const port = Number(process.env.PORT ?? 8787);
await app.listen({ port, host: "0.0.0.0" });
