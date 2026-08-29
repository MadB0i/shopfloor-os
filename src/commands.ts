import { z } from "zod";
import type { PoolClient } from "pg";
import type { EventType } from "./events/catalog.js";
import { appendEvent, lookupIdempotency, rememberIdempotency, requestHash } from "./events/store.js";

export type Actor = {
  userId: string;
  plantId: string;
  role: "operator" | "supervisor" | "planner" | "auditor";
};

export class HttpError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function denyAuditor(actor: Actor) {
  if (actor.role === "auditor") throw new HttpError(403, "auditor cannot write");
}

async function replayOrRun(
  client: PoolClient,
  plantId: string,
  idempotencyKey: string | undefined,
  hash: string,
  work: () => Promise<string>,
) {
  if (idempotencyKey) {
    const existing = await lookupIdempotency(client, plantId, idempotencyKey);
    if (existing) {
      if (existing.request_hash !== hash) {
        throw new HttpError(409, "idempotency key reused with a different body");
      }
      return { eventId: existing.event_id, replayed: true };
    }
  }
  const eventId = await work();
  if (idempotencyKey) {
    await rememberIdempotency(client, plantId, idempotencyKey, hash, eventId);
  }
  return { eventId, replayed: false };
}

async function requireReason(client: PoolClient, plantId: string, kind: "scrap" | "downtime", code: string) {
  const { rows } = await client.query(
    `SELECT 1 FROM reason_codes WHERE plant_id = $1 AND kind = $2 AND code = $3`,
    [plantId, kind, code],
  );
  if (!rows.length) throw new HttpError(400, `unknown ${kind} reason code`);
}

async function emit(
  client: PoolClient,
  actor: Actor,
  type: EventType,
  extra: {
    assetId?: string | null;
    workOrderId?: string | null;
    operationId?: string | null;
    payload?: Record<string, unknown>;
  },
) {
  return appendEvent(client, {
    plantId: actor.plantId,
    type,
    actorId: actor.userId,
    assetId: extra.assetId,
    workOrderId: extra.workOrderId,
    operationId: extra.operationId,
    payload: extra.payload,
  });
}

const startRun = z.object({
  assetId: z.string().min(1),
  workOrderId: z.string().min(1),
  operationId: z.string().min(1),
});

const assetOnly = z.object({ assetId: z.string().min(1) });

const qtyBody = z.object({
  assetId: z.string().min(1),
  workOrderId: z.string().min(1),
  operationId: z.string().min(1),
  qty: z.number().int().positive(),
});

const scrap = qtyBody.extend({ reasonCode: z.string().min(1) });

const downtimeStart = z.object({
  assetId: z.string().min(1),
  reasonCode: z.string().min(1),
});

const handoffSubmit = z.object({
  fromShift: z.string().min(1),
  toShift: z.string().min(1),
  note: z.string().max(500).optional(),
});

const handoffAccept = z.object({
  fromShift: z.string().min(1),
  toShift: z.string().min(1),
});

export async function handleStartRun(
  client: PoolClient,
  actor: Actor,
  body: unknown,
  idempotencyKey: string | undefined,
) {
  denyAuditor(actor);
  const parsed = startRun.parse(body);
  const hash = requestHash({ cmd: "run.start", ...parsed });
  return replayOrRun(client, actor.plantId, idempotencyKey, hash, async () => {
    const lock = await client.query(`SELECT asset_id FROM asset_locks WHERE asset_id = $1`, [parsed.assetId]);
    if (lock.rowCount) throw new HttpError(409, "asset already has an open run");
    const eventId = await emit(client, actor, "run.started", {
      assetId: parsed.assetId,
      workOrderId: parsed.workOrderId,
      operationId: parsed.operationId,
    });
    await client.query(
      `INSERT INTO asset_locks (asset_id, run_event_id, locked_by) VALUES ($1,$2,$3)`,
      [parsed.assetId, eventId, actor.userId],
    );
    return eventId;
  });
}

export async function handleCompleteRun(
  client: PoolClient,
  actor: Actor,
  body: unknown,
  idempotencyKey: string | undefined,
) {
  denyAuditor(actor);
  const parsed = assetOnly.parse(body);
  const hash = requestHash({ cmd: "run.complete", ...parsed });
  return replayOrRun(client, actor.plantId, idempotencyKey, hash, async () => {
    const lock = await client.query(
      `SELECT run_event_id FROM asset_locks WHERE asset_id = $1`,
      [parsed.assetId],
    );
    if (!lock.rowCount) throw new HttpError(409, "asset has no open run");
    const start = await client.query(
      `SELECT work_order_id, operation_id FROM floor_events WHERE event_id = $1`,
      [lock.rows[0].run_event_id],
    );
    const eventId = await emit(client, actor, "run.completed", {
      assetId: parsed.assetId,
      workOrderId: start.rows[0]?.work_order_id,
      operationId: start.rows[0]?.operation_id,
      payload: { startedEventId: lock.rows[0].run_event_id },
    });
    await client.query(`DELETE FROM asset_locks WHERE asset_id = $1`, [parsed.assetId]);
    return eventId;
  });
}

export async function handleGood(
  client: PoolClient,
  actor: Actor,
  body: unknown,
  idempotencyKey: string | undefined,
) {
  denyAuditor(actor);
  const parsed = qtyBody.parse(body);
  const hash = requestHash({ cmd: "qty.good", ...parsed });
  return replayOrRun(client, actor.plantId, idempotencyKey, hash, async () =>
    emit(client, actor, "qty.good_recorded", {
      assetId: parsed.assetId,
      workOrderId: parsed.workOrderId,
      operationId: parsed.operationId,
      payload: { qty: parsed.qty },
    }),
  );
}

export async function handleScrap(
  client: PoolClient,
  actor: Actor,
  body: unknown,
  idempotencyKey: string | undefined,
) {
  denyAuditor(actor);
  const parsed = scrap.parse(body);
  await requireReason(client, actor.plantId, "scrap", parsed.reasonCode);
  const hash = requestHash({ cmd: "qty.scrap", ...parsed });
  return replayOrRun(client, actor.plantId, idempotencyKey, hash, async () =>
    emit(client, actor, "qty.scrap_recorded", {
      assetId: parsed.assetId,
      workOrderId: parsed.workOrderId,
      operationId: parsed.operationId,
      payload: { qty: parsed.qty, reasonCode: parsed.reasonCode },
    }),
  );
}

export async function handleDowntimeStart(
  client: PoolClient,
  actor: Actor,
  body: unknown,
  idempotencyKey: string | undefined,
) {
  denyAuditor(actor);
  const parsed = downtimeStart.parse(body);
  await requireReason(client, actor.plantId, "downtime", parsed.reasonCode);
  const hash = requestHash({ cmd: "downtime.start", ...parsed });
  return replayOrRun(client, actor.plantId, idempotencyKey, hash, async () =>
    emit(client, actor, "downtime.started", {
      assetId: parsed.assetId,
      payload: { reasonCode: parsed.reasonCode },
    }),
  );
}

export async function handleDowntimeEnd(
  client: PoolClient,
  actor: Actor,
  body: unknown,
  idempotencyKey: string | undefined,
) {
  denyAuditor(actor);
  const parsed = assetOnly.parse(body);
  const hash = requestHash({ cmd: "downtime.end", ...parsed });
  return replayOrRun(client, actor.plantId, idempotencyKey, hash, async () => {
    const open = await client.query(
      `SELECT event_id FROM floor_events
       WHERE plant_id = $1 AND asset_id = $2 AND type = 'downtime.started'
       AND NOT EXISTS (
         SELECT 1 FROM floor_events e2
         WHERE e2.plant_id = $1 AND e2.asset_id = $2 AND e2.type = 'downtime.ended'
           AND e2.occurred_at >= floor_events.occurred_at
       )
       ORDER BY occurred_at DESC LIMIT 1`,
      [actor.plantId, parsed.assetId],
    );
    if (!open.rowCount) throw new HttpError(409, "asset has no open downtime");
    return emit(client, actor, "downtime.ended", {
      assetId: parsed.assetId,
      payload: { startedEventId: open.rows[0].event_id },
    });
  });
}

export async function handleHandoffSubmit(
  client: PoolClient,
  actor: Actor,
  body: unknown,
  idempotencyKey: string | undefined,
) {
  denyAuditor(actor);
  const parsed = handoffSubmit.parse(body);
  const hash = requestHash({ cmd: "handoff.submit", ...parsed });
  return replayOrRun(client, actor.plantId, idempotencyKey, hash, async () => {
    const locks = await client.query(
      `SELECT l.asset_id, l.run_event_id, l.locked_by
       FROM asset_locks l
       JOIN assets a ON a.id = l.asset_id
       WHERE a.plant_id = $1`,
      [actor.plantId],
    );
    return emit(client, actor, "handoff.submitted", {
      payload: {
        fromShift: parsed.fromShift,
        toShift: parsed.toShift,
        note: parsed.note ?? "",
        openRuns: locks.rows,
      },
    });
  });
}

export async function handleHandoffAccept(
  client: PoolClient,
  actor: Actor,
  body: unknown,
  idempotencyKey: string | undefined,
) {
  denyAuditor(actor);
  if (actor.role === "operator") {
    throw new HttpError(403, "only supervisor or planner can accept handoff");
  }
  const parsed = handoffAccept.parse(body);
  const hash = requestHash({ cmd: "handoff.accept", actor: actor.userId, ...parsed });
  return replayOrRun(client, actor.plantId, idempotencyKey, hash, async () =>
    emit(client, actor, "handoff.accepted", {
      payload: { fromShift: parsed.fromShift, toShift: parsed.toShift },
    }),
  );
}
