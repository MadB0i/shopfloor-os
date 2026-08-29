import { loadEnv } from "./env.js";
loadEnv();

import { pool } from "./db.js";

const plant = "PL-DEMO";

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO plants (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [
      plant,
      "Demo press shop",
    ]);
    await client.query(
      `INSERT INTO users (id, display_name) VALUES
        ('U-OP-1', 'Rina (operator)'),
        ('U-SUP-1', 'Kamal (supervisor)'),
        ('U-AUD-1', 'Audit desk')
       ON CONFLICT DO NOTHING`,
    );
    await client.query(
      `INSERT INTO memberships (plant_id, user_id, role) VALUES
        ($1, 'U-OP-1', 'operator'),
        ($1, 'U-SUP-1', 'supervisor'),
        ($1, 'U-AUD-1', 'auditor')
       ON CONFLICT DO NOTHING`,
      [plant],
    );
    await client.query(
      `INSERT INTO assets (id, plant_id, code, name) VALUES
        ('M-PRESS-01', $1, 'PRESS-01', 'Mechanical press 80T'),
        ('M-PRESS-02', $1, 'PRESS-02', 'Mechanical press 110T'),
        ('M-PACK-01', $1, 'PACK-01', 'Pack bench')
       ON CONFLICT DO NOTHING`,
      [plant],
    );
    await client.query(
      `INSERT INTO reason_codes (id, plant_id, kind, code, label) VALUES
        ('RC-D-WAIT-MAT', $1, 'downtime', 'WAIT-MATERIAL', 'Waiting on material'),
        ('RC-D-BREAK', $1, 'downtime', 'BREAKDOWN', 'Unplanned breakdown'),
        ('RC-D-CO', $1, 'downtime', 'CHANGEOVER', 'Tool / die changeover'),
        ('RC-S-DIM', $1, 'scrap', 'DIM-OOS', 'Dimension out of spec'),
        ('RC-S-SURF', $1, 'scrap', 'SURFACE', 'Surface defect')
       ON CONFLICT DO NOTHING`,
      [plant],
    );
    await client.query(
      `INSERT INTO work_orders (id, plant_id, code, due_at, target_qty) VALUES
        ('WO-24-0841', $1, 'WO-24-0841', now() + interval '3 days', 500)
       ON CONFLICT DO NOTHING`,
      [plant],
    );
    await client.query(
      `INSERT INTO operations (id, work_order_id, seq, name, default_asset_id) VALUES
        ('OP-0841-1', 'WO-24-0841', 1, 'Blank', 'M-PRESS-01'),
        ('OP-0841-2', 'WO-24-0841', 2, 'Form', 'M-PRESS-02'),
        ('OP-0841-3', 'WO-24-0841', 3, 'Pack', 'M-PACK-01')
       ON CONFLICT DO NOTHING`,
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
  process.stdout.write("seeded PL-DEMO\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
