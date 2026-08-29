import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { CURRENT_SCHEMA, isEventType, type EventType } from "./events/catalog.js";

export type FloorEventInput = {
  eventId?: string;
  plantId: string;
  type: EventType;
  actorId: string;
  assetId?: string | null;
  workOrderId?: string | null;
  operationId?: string | null;
  payload?: Record<string, unknown>;
  occurredAt?: Date;
};

export async function appendEvent(client: PoolClient, input: FloorEventInput) {
  if (!isEventType(input.type)) {
    throw new Error(`unknown event type: ${input.type}`);
  }
  const eventId = input.eventId ?? randomUUID();
  const payload = input.payload ?? {};
  await client.query(
    `INSERT INTO floor_events
      (event_id, plant_id, type, schema_version, actor_id, asset_id, work_order_id, operation_id, payload, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      eventId,
      input.plantId,
      input.type,
      CURRENT_SCHEMA,
      input.actorId,
      input.assetId ?? null,
      input.workOrderId ?? null,
      input.operationId ?? null,
      JSON.stringify(payload),
      input.occurredAt ?? new Date(),
    ],
  );
  return eventId;
}

export function requestHash(body: unknown) {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

export async function rememberIdempotency(
  client: PoolClient,
  plantId: string,
  key: string,
  hash: string,
  eventId: string,
) {
  await client.query(
    `INSERT INTO idempotency_keys (plant_id, key, request_hash, event_id)
     VALUES ($1,$2,$3,$4)`,
    [plantId, key, hash, eventId],
  );
}

export async function lookupIdempotency(client: PoolClient, plantId: string, key: string) {
  const { rows } = await client.query<{ request_hash: string; event_id: string }>(
    `SELECT request_hash, event_id FROM idempotency_keys WHERE plant_id = $1 AND key = $2`,
    [plantId, key],
  );
  return rows[0] ?? null;
}
