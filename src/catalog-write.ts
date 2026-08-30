import { z } from "zod";
import { authorize, HttpError, type Actor } from "./commands.js";
import { appendEvent } from "./events/store.js";
import type { SqlClient } from "./sql.js";

function duplicate(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  if (/unique|duplicate|23505/i.test(msg)) {
    throw new HttpError(409, "duplicate catalog row");
  }
  throw err;
}

const assetBody = z.object({
  id: z.string().min(1).optional(),
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
});

const reasonBody = z.object({
  id: z.string().min(1).optional(),
  kind: z.enum(["downtime", "scrap"]),
  code: z.string().min(1).max(40),
  label: z.string().min(1).max(120),
});

const woBody = z.object({
  id: z.string().min(1).optional(),
  code: z.string().min(1).max(40),
  targetQty: z.number().int().nonnegative(),
  dueAt: z.string().min(1).optional(),
});

const opBody = z.object({
  id: z.string().min(1).optional(),
  workOrderId: z.string().min(1),
  seq: z.number().int().min(1),
  name: z.string().min(1).max(80),
  defaultAssetId: z.string().min(1).optional(),
});

const shiftBody = z.object({
  id: z.string().min(1).optional(),
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(80),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
});

export async function handleCreateAsset(client: SqlClient, actor: Actor, body: unknown) {
  authorize(actor, "catalog.write");
  const parsed = assetBody.parse(body);
  const id = parsed.id ?? parsed.code;
  try {
    await client.query(
      `INSERT INTO assets (id, plant_id, code, name) VALUES ($1, $2, $3, $4)`,
      [id, actor.plantId, parsed.code, parsed.name],
    );
  } catch (err) {
    duplicate(err);
  }
  return { id };
}

export async function handleCreateReasonCode(client: SqlClient, actor: Actor, body: unknown) {
  authorize(actor, "catalog.write");
  const parsed = reasonBody.parse(body);
  const id = parsed.id ?? `RC-${parsed.kind}-${parsed.code}`;
  try {
    await client.query(
      `INSERT INTO reason_codes (id, plant_id, kind, code, label) VALUES ($1, $2, $3, $4, $5)`,
      [id, actor.plantId, parsed.kind, parsed.code, parsed.label],
    );
  } catch (err) {
    duplicate(err);
  }
  return { id };
}

export async function handleCreateWorkOrder(client: SqlClient, actor: Actor, body: unknown) {
  authorize(actor, "catalog.write");
  const parsed = woBody.parse(body);
  const id = parsed.id ?? parsed.code;
  const due = parsed.dueAt ? new Date(parsed.dueAt) : null;
  if (due && Number.isNaN(due.getTime())) throw new HttpError(400, "invalid dueAt");
  try {
    await client.query(
      `INSERT INTO work_orders (id, plant_id, code, due_at, target_qty) VALUES ($1, $2, $3, $4, $5)`,
      [id, actor.plantId, parsed.code, due, parsed.targetQty],
    );
  } catch (err) {
    duplicate(err);
  }
  const eventId = await appendEvent(client, {
    plantId: actor.plantId,
    type: "work_order.opened",
    actorId: actor.userId,
    workOrderId: id,
    payload: { code: parsed.code, targetQty: parsed.targetQty },
  });
  return { id, eventId };
}

export async function handleCreateOperation(client: SqlClient, actor: Actor, body: unknown) {
  authorize(actor, "catalog.write");
  const parsed = opBody.parse(body);
  const wo = await client.query(
    `SELECT 1 FROM work_orders WHERE id = $1 AND plant_id = $2`,
    [parsed.workOrderId, actor.plantId],
  );
  if (!wo.rowCount) throw new HttpError(400, "unknown work order");
  if (parsed.defaultAssetId) {
    const asset = await client.query(
      `SELECT 1 FROM assets WHERE id = $1 AND plant_id = $2`,
      [parsed.defaultAssetId, actor.plantId],
    );
    if (!asset.rowCount) throw new HttpError(400, "unknown default asset");
  }
  const id = parsed.id ?? `${parsed.workOrderId}-OP-${parsed.seq}`;
  try {
    await client.query(
      `INSERT INTO operations (id, work_order_id, seq, name, default_asset_id) VALUES ($1, $2, $3, $4, $5)`,
      [id, parsed.workOrderId, parsed.seq, parsed.name, parsed.defaultAssetId ?? null],
    );
  } catch (err) {
    duplicate(err);
  }
  return { id };
}

export async function handleCreateShift(client: SqlClient, actor: Actor, body: unknown) {
  authorize(actor, "catalog.write");
  const parsed = shiftBody.parse(body);
  const id = parsed.id ?? `SHIFT-${parsed.code}`;
  try {
    await client.query(
      `INSERT INTO shifts (id, plant_id, code, name, starts_at, ends_at) VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, actor.plantId, parsed.code, parsed.name, parsed.startsAt ?? null, parsed.endsAt ?? null],
    );
  } catch (err) {
    duplicate(err);
  }
  return { id };
}
