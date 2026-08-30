import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import { actorFromHeader, canReadFullTape, capabilitiesFor, tokensFromEnv } from "./auth.js";
import {
  handleCompleteRun,
  handleCorrect,
  handleDowntimeEnd,
  handleDowntimeStart,
  handleGood,
  handleHandoffAccept,
  handleHandoffOverride,
  handleHandoffSubmit,
  handlePauseRun,
  handleResumeRun,
  handleScrap,
  handleStartRun,
  HttpError,
} from "./commands.js";
import {
  handleCreateAsset,
  handleCreateOperation,
  handleCreateReasonCode,
  handleCreateShift,
  handleCreateWorkOrder,
} from "./catalog-write.js";
import { pool } from "./db.js";
import type { SqlPool } from "./db.js";
import { annotateVoided } from "./effective.js";
import { isEventType } from "./events/catalog.js";
import { eventsToCsv } from "./csv.js";
import { loadFloor } from "./floor.js";
import { computeAssetOee, computePlantOee } from "./oee.js";
import { loadTape } from "./tape.js";

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

export async function build(db: SqlPool = pool) {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  async function runCommand(
    req: { headers: Record<string, unknown>; body: unknown; actor: ReqActor },
    reply: { code: (n: number) => unknown },
    fn: (
      client: import("./db.js").SqlClient,
      actor: ReqActor,
      body: unknown,
      key: string | undefined,
    ) => Promise<unknown>,
  ) {
    const raw = req.headers["idempotency-key"];
    const idem = typeof raw === "string" ? raw : undefined;
    const client = await db.connect();
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

  app.get("/health", async (_req, reply) => {
    try {
      await db.query("SELECT 1 AS ok");
      return { ok: true, db: db.kind };
    } catch (err) {
      reply.code(503);
      return { ok: false, error: err instanceof Error ? err.message : "db" };
    }
  });

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

  // Identity + capabilities for the authenticated token. The board calls this
  // on load to learn which actions to show — the `can` map is the same one the
  // backend guards enforce (see auth.ts), so the UI mirrors the server exactly.
  app.get("/v1/me", async (req) => {
    const actor = actorOf(req);
    return {
      userId: actor.userId,
      plantId: actor.plantId,
      role: actor.role,
      can: capabilitiesFor(actor.role),
    };
  });

  app.post("/v1/commands/run.start", async (req, reply) =>
    runCommand(req as never, reply, handleStartRun),
  );
  app.post("/v1/commands/run.complete", async (req, reply) =>
    runCommand(req as never, reply, handleCompleteRun),
  );
  app.post("/v1/commands/run.pause", async (req, reply) =>
    runCommand(req as never, reply, handlePauseRun),
  );
  app.post("/v1/commands/run.resume", async (req, reply) =>
    runCommand(req as never, reply, handleResumeRun),
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
  app.post("/v1/commands/handoff.override", async (req, reply) =>
    runCommand(req as never, reply, handleHandoffOverride),
  );
  app.post("/v1/commands/record.correct", async (req, reply) =>
    runCommand(req as never, reply, handleCorrect),
  );

  const catalogWrite = async (
    req: { body: unknown; actor?: ReqActor },
    reply: { code: (n: number) => unknown },
    fn: (client: import("./db.js").SqlClient, actor: ReqActor, body: unknown) => Promise<unknown>,
  ) => {
    const actor = (req as { actor: ReqActor }).actor;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client, actor, req.body);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      (reply as { code: (n: number) => void }).code(statusOf(err));
      return { error: err instanceof Error ? err.message : "failed" };
    } finally {
      client.release();
    }
  };

  app.post("/v1/catalog/assets", async (req, reply) => catalogWrite(req as never, reply, handleCreateAsset));
  app.post("/v1/catalog/reason-codes", async (req, reply) =>
    catalogWrite(req as never, reply, handleCreateReasonCode),
  );
  app.post("/v1/catalog/work-orders", async (req, reply) =>
    catalogWrite(req as never, reply, handleCreateWorkOrder),
  );
  app.post("/v1/catalog/operations", async (req, reply) =>
    catalogWrite(req as never, reply, handleCreateOperation),
  );
  app.post("/v1/catalog/shifts", async (req, reply) =>
    catalogWrite(req as never, reply, handleCreateShift),
  );

  app.get("/v1/floor", async (req, reply) => {
    const actor = actorOf(req);
    const floor = await loadFloor(db, actor.plantId);
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
    const floor = await loadFloor(db, plantId);
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
    const { rows } = await db.query(
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
    return { workOrderId: id, events: await annotateVoided(db, actor.plantId, rows) };
  });

  app.get("/v1/tape", async (req, reply) => {
    const actor = actorOf(req);
    if (!canReadFullTape(actor.role)) {
      reply.code(403);
      return { error: "full tape is auditor-only" };
    }
    const q = req.query as { from?: string; to?: string };
    const from = q.from ? new Date(q.from) : undefined;
    const to = q.to ? new Date(q.to) : undefined;
    if (from && Number.isNaN(from.getTime())) {
      reply.code(400);
      return { error: "invalid from" };
    }
    if (to && Number.isNaN(to.getTime())) {
      reply.code(400);
      return { error: "invalid to" };
    }
    const events = await loadTape(db, actor.plantId, from, to);
    return { plantId: actor.plantId, events };
  });

  app.get("/v1/export/events.csv", async (req, reply) => {
    const actor = actorOf(req);
    const q = req.query as { from?: string; to?: string };
    const from = q.from ? new Date(q.from) : undefined;
    const to = q.to ? new Date(q.to) : undefined;
    if (from && Number.isNaN(from.getTime())) {
      reply.code(400);
      return { error: "invalid from" };
    }
    if (to && Number.isNaN(to.getTime())) {
      reply.code(400);
      return { error: "invalid to" };
    }
    const events = await loadTape(db, actor.plantId, from, to, 50_000);
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", 'attachment; filename="shopfloor-events.csv"');
    return reply.send(eventsToCsv(events));
  });

  app.get("/v1/metrics/oee", async (req, reply) => {
    const actor = actorOf(req);
    const q = req.query as { from?: string; to?: string; asset?: string };
    if (!q.from || !q.to) {
      reply.code(400);
      return { error: "from and to are required ISO timestamps" };
    }
    const from = new Date(q.from);
    const to = new Date(q.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      reply.code(400);
      return { error: "invalid from or to" };
    }
    if (from.getTime() >= to.getTime()) {
      reply.code(400);
      return { error: "from must be before to" };
    }
    if (q.asset) {
      const exists = await db.query(`SELECT 1 FROM assets WHERE id = $1 AND plant_id = $2`, [
        q.asset,
        actor.plantId,
      ]);
      if (!exists.rowCount) {
        reply.code(404);
        return { error: "unknown asset" };
      }
      return computeAssetOee(db, actor.plantId, q.asset, from, to);
    }
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      assets: await computePlantOee(db, actor.plantId, from, to),
    };
  });

  await app.register(fastifyStatic, { root: webRoot, prefix: "/" });
  return app;
}
