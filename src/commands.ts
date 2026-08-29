import { z } from "zod";
import type { PoolClient } from "pg";
import { appendEvent, lookupIdempotency, rememberIdempotency, requestHash } from "./events/store.js";

export type Actor = {
  userId: string;
  plantId: string;
  role: "operator" | "supervisor" | "planner" | "auditor";
};

const startRun = z.object({
  assetId: z.string().min(1),
  workOrderId: z.string().min(1),
  operationId: z.string().min(1),
});

const scrap = z.object({
  assetId: z.string().min(1),
  workOrderId: z.string().min(1),
  operationId: z.string().min(1),
  qty: z.number().int().positive(),
  reasonCode: z.string().min(1),
});

const downtimeStart = z.object({
  assetId: z.string().min(1),
  reasonCode: z.string().min(1),
});

function denyAuditor(actor: Actor) {
  if (actor.role === "auditor") {
    const err = new Error("auditor cannot write");
    (err as Error & { statusCode: number }).statusCode = 403;
    throw err;
  }
}

export async function handleStartRun(
  client: PoolClient,
  actor: Actor,
  body: unknown,
  idempotencyKey: string | undefined,
) {
  denyAuditor(actor);
  const parsed = startRun.parse(body);
  const hash = requestHash({ cmd: "run.start", ...parsed });
  if (idempotencyKey) {
    const existing = await lookupIdempotency(client, actor.plantId, idempotencyKey);
    if (existing) {
      if (existing.request_hash !== hash) {
        const err = new Error("idempotency key reused with a different body");
        (err as Error & { statusCode: number }).statusCode = 409;
        throw err;
      }
      return { eventId: existing.event_id, replayed: true };
    }
  }

  const lock = await client.query(`SELECT asset_id FROM asset_locks WHERE asset_id = $1`, [
    parsed.assetId,
  ]);
  if (lock.rowCount) {
    const err = new Error("asset already has an open run");
    (err as Error & { statusCode: number }).statusCode = 409;
    throw err;
  }

  const eventId = await appendEvent(client, {
    plantId: actor.plantId,
    type: "run.started",
    actorId: actor.userId,
    assetId: parsed.assetId,
    workOrderId: parsed.workOrderId,
    operationId: parsed.operationId,
    payload: {},
  });

  await client.query(
    `INSERT INTO asset_locks (asset_id, run_event_id, locked_by) VALUES ($1,$2,$3)`,
    [parsed.assetId, eventId, actor.userId],
  );

  if (idempotencyKey) {
    await rememberIdempotency(client, actor.plantId, idempotencyKey, hash, eventId);
  }
  return { eventId, replayed: false };
}

export async function handleScrap(
  client: PoolClient,
  actor: Actor,
  body: unknown,
  idempotencyKey: string | undefined,
) {
  denyAuditor(actor);
  const parsed = scrap.parse(body);
  const { rows } = await client.query(
    `SELECT 1 FROM reason_codes WHERE plant_id = $1 AND kind = 'scrap' AND code = $2`,
    [actor.plantId, parsed.reasonCode],
  );
  if (!rows.length) {
    const err = new Error("unknown scrap reason code");
    (err as Error & { statusCode: number }).statusCode = 400;
    throw err;
  }

  const hash = requestHash({ cmd: "qty.scrap", ...parsed });
  if (idempotencyKey) {
    const existing = await lookupIdempotency(client, actor.plantId, idempotencyKey);
    if (existing) {
      if (existing.request_hash !== hash) {
        const err = new Error("idempotency key reused with a different body");
        (err as Error & { statusCode: number }).statusCode = 409;
        throw err;
      }
      return { eventId: existing.event_id, replayed: true };
    }
  }

  const eventId = await appendEvent(client, {
    plantId: actor.plantId,
    type: "qty.scrap_recorded",
    actorId: actor.userId,
    assetId: parsed.assetId,
    workOrderId: parsed.workOrderId,
    operationId: parsed.operationId,
    payload: { qty: parsed.qty, reasonCode: parsed.reasonCode },
  });

  if (idempotencyKey) {
    await rememberIdempotency(client, actor.plantId, idempotencyKey, hash, eventId);
  }
  return { eventId, replayed: false };
}

export async function handleDowntimeStart(
  client: PoolClient,
  actor: Actor,
  body: unknown,
  idempotencyKey: string | undefined,
) {
  denyAuditor(actor);
  const parsed = downtimeStart.parse(body);
  const { rows } = await client.query(
    `SELECT 1 FROM reason_codes WHERE plant_id = $1 AND kind = 'downtime' AND code = $2`,
    [actor.plantId, parsed.reasonCode],
  );
  if (!rows.length) {
    const err = new Error("unknown downtime reason code");
    (err as Error & { statusCode: number }).statusCode = 400;
    throw err;
  }

  const hash = requestHash({ cmd: "downtime.start", ...parsed });
  if (idempotencyKey) {
    const existing = await lookupIdempotency(client, actor.plantId, idempotencyKey);
    if (existing) {
      if (existing.request_hash !== hash) {
        const err = new Error("idempotency key reused with a different body");
        (err as Error & { statusCode: number }).statusCode = 409;
        throw err;
      }
      return { eventId: existing.event_id, replayed: true };
    }
  }

  const eventId = await appendEvent(client, {
    plantId: actor.plantId,
    type: "downtime.started",
    actorId: actor.userId,
    assetId: parsed.assetId,
    payload: { reasonCode: parsed.reasonCode },
  });

  if (idempotencyKey) {
    await rememberIdempotency(client, actor.plantId, idempotencyKey, hash, eventId);
  }
  return { eventId, replayed: false };
}
