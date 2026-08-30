import { effectiveQtySum } from "./effective.js";
import type { SqlPool } from "./sql.js";

export type OeeScore = {
  assetId: string;
  from: string;
  to: string;
  availability: number | null;
  performance: number | null;
  quality: number | null;
  oee: number | null;
  parts: {
    plannedMs: number;
    downtimeMs: number;
    good: number;
    scrap: number;
    targetQty: number | null;
    workOrderIds: string[];
  };
};

function at(value: Date | string) {
  return new Date(value).getTime();
}

function ratio(num: number, den: number) {
  if (den <= 0) return null;
  return num / den;
}

function overlapMs(start: number, end: number, winStart: number, winEnd: number) {
  const a = Math.max(start, winStart);
  const b = Math.min(end, winEnd);
  return Math.max(0, b - a);
}

async function downtimeMsInWindow(pool: SqlPool, plantId: string, assetId: string, from: Date, to: Date) {
  const { rows } = await pool.query<{ type: string; occurred_at: Date }>(
    `SELECT type, occurred_at FROM floor_events
     WHERE plant_id = $1 AND asset_id = $2 AND type IN ('downtime.started', 'downtime.ended')
     ORDER BY occurred_at ASC, id ASC`,
    [plantId, assetId],
  );
  const ends: number[] = [];
  const starts: number[] = [];
  for (const row of rows) {
    const t = at(row.occurred_at);
    if (row.type === "downtime.started") starts.push(t);
    else ends.push(t);
  }
  let ei = 0;
  let total = 0;
  const winStart = from.getTime();
  const winEnd = to.getTime();
  for (const start of starts) {
    while (ei < ends.length && ends[ei] < start) ei += 1;
    const end = ei < ends.length ? ends[ei] : winEnd;
    if (ei < ends.length) ei += 1;
    total += overlapMs(start, end, winStart, winEnd);
  }
  return Math.min(total, Math.max(0, winEnd - winStart));
}

async function workOrdersInWindow(pool: SqlPool, plantId: string, assetId: string, from: Date, to: Date) {
  const { rows } = await pool.query<{ work_order_id: string }>(
    `SELECT DISTINCT work_order_id FROM floor_events
     WHERE plant_id = $1 AND asset_id = $2 AND type = 'run.started'
       AND work_order_id IS NOT NULL
       AND occurred_at >= $3 AND occurred_at < $4`,
    [plantId, assetId, from.toISOString(), to.toISOString()],
  );
  return rows.map((r) => r.work_order_id);
}

export async function computeAssetOee(
  pool: SqlPool,
  plantId: string,
  assetId: string,
  from: Date,
  to: Date,
): Promise<OeeScore> {
  const plannedMs = Math.max(0, to.getTime() - from.getTime());
  const downMs = plannedMs === 0 ? 0 : await downtimeMsInWindow(pool, plantId, assetId, from, to);
  const availability = ratio(plannedMs - downMs, plannedMs);

  const good = await effectiveQtySum(pool, plantId, "qty.good_recorded", { assetId, from, to });
  const scrap = await effectiveQtySum(pool, plantId, "qty.scrap_recorded", { assetId, from, to });
  const quality = ratio(good, good + scrap);

  const workOrderIds = await workOrdersInWindow(pool, plantId, assetId, from, to);
  let targetQty: number | null = null;
  let performance: number | null = null;
  if (workOrderIds.length === 1) {
    const wo = await pool.query<{ target_qty: number }>(
      `SELECT target_qty FROM work_orders WHERE id = $1 AND plant_id = $2`,
      [workOrderIds[0], plantId],
    );
    if (wo.rowCount) {
      targetQty = Number(wo.rows[0].target_qty);
      performance = ratio(good, targetQty);
    }
  }

  const oee =
    availability == null || performance == null || quality == null
      ? null
      : availability * performance * quality;

  return {
    assetId,
    from: from.toISOString(),
    to: to.toISOString(),
    availability,
    performance,
    quality,
    oee,
    parts: {
      plannedMs,
      downtimeMs: downMs,
      good,
      scrap,
      targetQty,
      workOrderIds,
    },
  };
}

export async function computePlantOee(pool: SqlPool, plantId: string, from: Date, to: Date) {
  const assets = await pool.query<{ id: string }>(
    `SELECT id FROM assets WHERE plant_id = $1 ORDER BY code`,
    [plantId],
  );
  const scores = [];
  for (const row of assets.rows) {
    scores.push(await computeAssetOee(pool, plantId, row.id, from, to));
  }
  return scores;
}
