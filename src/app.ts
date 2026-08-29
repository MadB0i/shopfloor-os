import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import { actorFromHeader, tokensFromEnv } from "./auth.js";
import {
  handleCompleteRun,
  handleDowntimeEnd,
  handleDowntimeStart,
  handleGood,
  handleHandoffAccept,
  handleHandoffSubmit,
  handleScrap,
  handleStartRun,
  HttpError,
} from "./commands.js";
import { pool } from "./db.js";
import { isEventType } from "./events/catalog.js";
import { loadFloor } from "./floor.js";

const tokens = tokensFromEnv();
const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "web");

function statusOf(err: unknown): number {
  if (err instanceof HttpError) return err.statusCode;
  if (err instanceof ZodError) return 400;
  if (err && typeof err === "object" && "statusCode" in err && typeof (err as { statusCode: number }).statusCode === "number") {
    return (err as { statusCode: number }).statusCode;
  }
  return 500;
}

type ReqActor = NonNullable<ReturnType<typeof actorFromHeader>>;

async function runCommand(
  req: { headers: Record<string, unknown>; body: unknown; actor: ReqActor },
  reply: { code: (n: number) => unknown },
  fn: (
    client: import("pg").PoolClient,
    actor: ReqActor,
    body: unknown,
    key: string | undefined,
  ) => Promise<unknown>,
) {
  const raw = req.headers["idempotency-key"];
  const idem = typeof raw === "string" ? raw : undefined;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client, req.actor, req.body, idem);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    (reply as { code: (n: number) => void }).code(statusOf(err));
    return { error: err instanceof Error ? err.message : "failed" };
  } finally {
    client.release();
  }
}

export async function build() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  app.get("/health", async () => ({ ok: true }));

  app.addHook("preHandler", async (req, reply) => {
    const url = req.url.split("?")[0];
    if (url === "/health") return;
    if (!url.startsWith("/v1")) return;
    const actor = actorFromHeader(req.headers.authorization, tokens);
    if (!actor) {
      reply.code(401).send({ error: "missing or unknown bearer token" });
      return;
    }
    (req as typeof req & { actor: ReqActor }).actor = actor;
  });

  const actorOf = (req: unknown) => (req as { actor: ReqActor }).actor;

  app.post("/v1/commands/run.start", async (req, reply) =>
    runCommand(req as never, reply, handleStartRun),
  );
  app.post("/v1/commands/run.complete", async (req, reply) =>
    runCommand(req as never, reply, handleCompleteRun),
  );
  app.post("/v1/commands/qty.good", async (req, reply) => runCommand(req as never, reply, handleGood));
  app.post("/v1/commands/qty.scrap", async (req, reply) => runCommand(req as never, reply, handleScrap));
  app.post("/v1/commands/downtime.start", async (req, reply) =>
    runCommand(req as never, reply, handleDowntimeStart),
  );
  app.post("/v1/commands/downtime.end", async (req, reply) =>
    runCommand(req as never, reply, handleDowntimeEnd),
  );
  app.post("/v1/commands/handoff.submit", async (req, reply) =>
    runCommand(req as never, reply, handleHandoffSubmit),
  );
  app.post("/v1/commands/handoff.accept", async (req, reply) =>
    runCommand(req as never, reply, handleHandoffAccept),
  );

  app.get("/v1/floor", async (req, reply) => {
    const actor = actorOf(req);
    const floor = await loadFloor(pool, actor.plantId);
    if (!floor) {
      reply.code(404);
      return { error: "plant not found" };
    }
    return floor;
  });

  app.get("/v1/plants/:plantId/assets/:assetId/live", async (req, reply) => {
    const actor = actorOf(req);
    const { plantId, assetId } = req.params as { plantId: string; assetId: string };
    if (plantId !== actor.plantId) {
      reply.code(403);
      return { error: "plant mismatch" };
    }
    const floor = await loadFloor(pool, plantId);
    const asset = floor?.assets.find((a) => a.id === assetId);
    if (!asset) {
      reply.code(404);
      return { error: "unknown asset" };
    }
    return { assetId, openRun: asset.openRun, openDowntime: asset.openDowntime };
  });

  app.get("/v1/work-orders/:id/timeline", async (req, reply) => {
    const actor = actorOf(req);
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

  await app.register(fastifyStatic, { root: webRoot, prefix: "/" });
  return app;
}
