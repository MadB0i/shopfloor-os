import type { SqlClient, SqlPool } from "./sql.js";

type Queryable = Pick<SqlClient, "query"> | Pick<SqlPool, "query">;

export function replacesEventIdFromPayload(payload: unknown): string | null {
  let body = payload;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body) as unknown;
    } catch {
      return null;
    }
  }
  if (body && typeof body === "object" && "replacesEventId" in body) {
    const id = (body as { replacesEventId: unknown }).replacesEventId;
    return typeof id === "string" && id.length > 0 ? id : null;
  }
  return null;
}

export function qtyFromPayload(payload: unknown): number {
  let body = payload;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body) as unknown;
    } catch {
      return 0;
    }
  }
  if (body && typeof body === "object" && "qty" in body) {
    const n = Number((body as { qty: unknown }).qty);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export async function supersededEventIds(db: Queryable, plantId: string) {
  const { rows } = await db.query<{ payload: unknown }>(
    `SELECT payload FROM floor_events WHERE plant_id = $1 AND type = 'record.corrected'`,
    [plantId],
  );
  const ids = new Set<string>();
  for (const row of rows) {
    const id = replacesEventIdFromPayload(row.payload);
    if (id) ids.add(id);
  }
  return ids;
}

/** Qty totals for OEE quality — ignores events named by `record.corrected`. */
export async function effectiveQtySum(
  db: Queryable,
  plantId: string,
  type: "qty.good_recorded" | "qty.scrap_recorded",
  scope?: { assetId?: string; from?: Date; to?: Date },
) {
  const dead = await supersededEventIds(db, plantId);
  const { rows } = await db.query<{ event_id: string; payload: unknown; asset_id: string | null; occurred_at: Date }>(
    `SELECT event_id, payload, asset_id, occurred_at FROM floor_events WHERE plant_id = $1 AND type = $2`,
    [plantId, type],
  );
  let sum = 0;
  for (const row of rows) {
    if (dead.has(row.event_id)) continue;
    if (scope?.assetId && row.asset_id !== scope.assetId) continue;
    const t = new Date(row.occurred_at).getTime();
    if (scope?.from && t < scope.from.getTime()) continue;
    if (scope?.to && t >= scope.to.getTime()) continue;
    sum += qtyFromPayload(row.payload);
  }
  return sum;
}

export async function annotateVoided<T extends { event_id: string }>(
  db: Queryable,
  plantId: string,
  rows: T[],
) {
  const dead = await supersededEventIds(db, plantId);
  return rows.map((row) => ({ ...row, voided: dead.has(row.event_id) }));
}
