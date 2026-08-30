import type { SqlClient, SqlPool } from "./sql.js";

type Queryable = Pick<SqlClient, "query"> | Pick<SqlPool, "query">;

export function shiftPairFromPayload(payload: unknown): { fromShift: string; toShift: string } | null {
  let body = payload;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body) as unknown;
    } catch {
      return null;
    }
  }
  if (!body || typeof body !== "object") return null;
  const fromShift = (body as { fromShift?: unknown }).fromShift;
  const toShift = (body as { toShift?: unknown }).toShift;
  if (typeof fromShift !== "string" || typeof toShift !== "string") return null;
  if (!fromShift || !toShift) return null;
  return { fromShift, toShift };
}

export async function pendingHandoff(db: Queryable, plantId: string) {
  const latest = await db.query<{ payload: unknown; occurred_at: Date }>(
    `SELECT payload, occurred_at FROM floor_events
     WHERE plant_id = $1 AND type = 'handoff.submitted'
     ORDER BY occurred_at DESC, id DESC
     LIMIT 1`,
    [plantId],
  );
  if (!latest.rowCount) return null;
  const pair = shiftPairFromPayload(latest.rows[0].payload);
  if (!pair) return null;
  const clears = await db.query<{ type: string; payload: unknown }>(
    `SELECT type, payload FROM floor_events
     WHERE plant_id = $1 AND type IN ('handoff.accepted', 'handoff.overridden')
       AND occurred_at >= $2
     ORDER BY occurred_at ASC, id ASC`,
    [plantId, latest.rows[0].occurred_at],
  );
  for (const row of clears.rows) {
    const cleared = shiftPairFromPayload(row.payload);
    if (cleared && cleared.fromShift === pair.fromShift && cleared.toShift === pair.toShift) {
      return null;
    }
  }
  return pair;
}
