import { z } from "zod";
import type { SqlClient } from "./db.js";
import type { EventType } from "./events/catalog.js";
import { assetIsPaused } from "./projections.js";
import { supersededEventIds } from "./effective.js";
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
  client: SqlClient,
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

async function requireReason(client: SqlClient, plantId: string, kind: "scrap" | "downtime", code: string) {
  const { rows } = await client.query(
    `SELECT 1 FROM reason_codes WHERE plant_id = $1 AND kind = $2 AND code = $3`,
    [plantId, kind, code],
  );
  if (!rows.length) throw new HttpError(400, `unknown ${kind} reason code`);
}

async function emit(
  client: SqlClient,
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

async function assertRoutingAllowsStart(
  client: SqlClient,
  plantId: string,
  workOrderId: string,
  operationId: string,
) {
  const wo = await client.query(
    `SELECT 1 FROM work_orders WHERE id = $1 AND plant_id = $2`,
    [workOrderId, plantId],
  );
  if (!wo.rowCount) throw new HttpError(400, "unknown work order");

  const op = await client.query<{ seq: number; work_order_id: string }>(
    `SELECT seq, work_order_id FROM operations WHERE id = $1`,
    [operationId],
  );
  if (!op.rowCount) throw new HttpError(400, "unknown operation");
  if (op.rows[0].work_order_id !== workOrderId) {
    throw new HttpError(400, "operation does not belong to this work order");
  }

  const seq = Number(op.rows[0].seq);
  if (seq <= 1) return;

  const prev = await client.query<{ id: string }>(
    `SELECT id FROM operations WHERE work_order_id = $1 AND seq = $2`,
    [workOrderId, seq - 1],
  );
  if (!prev.rowCount) throw new HttpError(400, "routing gap: missing previous operation");

  const done = await client.query(
    `SELECT 1 FROM floor_events
     WHERE plant_id = $1 AND work_order_id = $2 AND operation_id = $3 AND type = 'run.completed'
     LIMIT 1`,
    [plantId, workOrderId, prev.rows[0].id],
  );
  if (!done.rowCount) throw new HttpError(409, "previous operation is not complete");
}

export async function handleStartRun(
  client: SqlClient,
  actor: Actor,
  body: unknown,
  idempotencyKey: string | undefined,
) {
  denyAuditor(actor);
  const parsed = startRun.parse(body);
  const hash = requestHash({ cmd: "run.start", ...parsed });
  return replayOrRun(client, actor.plantId, idempotencyKey, hash, async () => {
    await assertRoutingAllowsStart(client, actor.plantId, parsed.workOrderId, parsed.operationId);
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
  client: SqlClient,
  actor: Actor,
  body: unknown,
  idempotencyKey: string | undefined,
) {
  denyAuditor(actor);
  const parsed = assetOnly.parse(body);
  const hash = requestHash({ cmd: "run.complete", ...parsed });
  return replayOrRun(client, actor.plantId, idempotencyKey, hash, async () => {
    const startId = await requireOpenLock(client, parsed.assetId);
    const start = await client.query(
      `SELECT work_order_id, operation_id FROM floor_events WHERE event_id = $1`,
      [startId],
    );
    const eventId = await emit(client, actor, "run.completed", {
      assetId: parsed.assetId,
      workOrderId: start.rows[0]?.work_order_id,
      operationId: start.rows[0]?.operation_id,
      payload: { startedEventId: startId },
    });
    await client.query(`DELETE FROM asset_locks WHERE asset_id = $1`, [parsed.assetId]);
    return eventId;
  });
}

async function requireOpenLock(client: SqlClient, assetId: string) {
  const lock = await client.query<{ run_event_id: string }>(
    `SELECT run_event_id FROM asset_locks WHERE asset_id = $1`,
    [assetId],
  );
  if (!lock.rowCount) throw new HttpError(409, "asset has no open run");
  return lock.rows[0].run_event_id;
}

export async function handlePauseRun(
  client: SqlClient,
  actor: Actor,
  body: unknown,
  idempotencyKey: string | undefined,
) {
  denyAuditor(actor);
  const parsed = assetOnly.parse(body);
  const hash = requestHash({ cmd: "run.pause", ...parsed });
  return replayOrRun(client, actor.plantId, idempotencyKey, hash, async () => {
    const startId = await requireOpenLock(client, parsed.assetId);
    if (await assetIsPaused(client, parsed.assetId)) {
      throw new HttpError(409, "run is already paused");
    }
    const start = await client.query(
      `SELECT work_order_id, operation_id FROM floor_events WHERE event_id = $1`,
      [startId],
    );
    return emit(client, actor, "run.paused", {
      assetId: parsed.assetId,
      workOrderId: start.rows[0]?.work_order_id,
      operationId: start.rows[0]?.operation_id,
      payload: { startedEventId: startId },
    });
  });
}

export async function handleResumeRun(
  client: SqlClient,
  actor: Actor,
  body: unknown,
  idempotencyKey: string | undefined,
) {
  denyAuditor(actor);
  const parsed = assetOnly.parse(body);
  const hash = requestHash({ cmd: "run.resume", ...parsed });
  return replayOrRun(client, actor.plantId, idempotencyKey, hash, async () => {
    const startId = await requireOpenLock(client, parsed.assetId);
    if (!(await assetIsPaused(client, parsed.assetId))) {
      throw new HttpError(409, "run is not paused");
    }
    const start = await client.query(
      `SELECT work_order_id, operation_id FROM floor_events WHERE event_id = $1`,
      [startId],
    );
    return emit(client, actor, "run.resumed", {
      assetId: parsed.assetId,
      workOrderId: start.rows[0]?.work_order_id,
      operationId: start.rows[0]?.operation_id,
      payload: { startedEventId: startId },
    });
  });
}

export async function handleGood(
  client: SqlClient,
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
  client: SqlClient,
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
  client: SqlClient,
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
  client: SqlClient,
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
  client: SqlClient,
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
  client: SqlClient,
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

const correctBody = z.object({
  replacesEventId: z.string().min(1),
  reason: z.string().min(1).max(200),
});

const CORRECTABLE = new Set(["qty.good_recorded", "qty.scrap_recorded"]);

export async function handleCorrect(
  client: SqlClient,
  actor: Actor,
  body: unknown,
  idempotencyKey: string | undefined,
) {
  denyAuditor(actor);
  const parsed = correctBody.parse(body);
  const hash = requestHash({ cmd: "record.correct", ...parsed });
  return replayOrRun(client, actor.plantId, idempotencyKey, hash, async () => {
    const original = await client.query<{
      event_id: string;
      type: string;
      asset_id: string | null;
      work_order_id: string | null;
      operation_id: string | null;
    }>(
      `SELECT event_id, type, asset_id, work_order_id, operation_id
       FROM floor_events WHERE event_id = $1 AND plant_id = $2`,
      [parsed.replacesEventId, actor.plantId],
    );
    if (!original.rowCount) throw new HttpError(400, "unknown event in this plant");
    if (!CORRECTABLE.has(original.rows[0].type)) {
      throw new HttpError(400, "only qty.good_recorded and qty.scrap_recorded can be corrected");
    }
    const dead = await supersededEventIds(client, actor.plantId);
    if (dead.has(parsed.replacesEventId)) {
      throw new HttpError(409, "event already has a correction");
    }
    const src = original.rows[0];
    return emit(client, actor, "record.corrected", {
      assetId: src.asset_id,
      workOrderId: src.work_order_id,
      operationId: src.operation_id,
      payload: { replacesEventId: parsed.replacesEventId, reason: parsed.reason },
    });
  });
}
