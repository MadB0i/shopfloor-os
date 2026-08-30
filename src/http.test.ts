import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { build } from "./app.js";
import { pool as defaultPool } from "./db.js";
import { applyMigrations } from "./schema.js";
import { seedPlant } from "./seed-plant.js";
import { createPoolFromUrl, type SqlPool } from "./sql.js";

// Happy-path + role-gated HTTP tests at the Fastify layer, using in-app
// injection (no live socket). Each scenario runs on its own in-memory PGlite
// DB seeded with the demo floor (events included) so floor/tape/oee are
// populated and assertions are against real data.

let pool: SqlPool | undefined;
let app: FastifyInstance | undefined;

const OPERATOR = { Authorization: "Bearer dev-operator" };
const SUPERVISOR = { Authorization: "Bearer dev-supervisor" };
const PLANNER = { Authorization: "Bearer dev-planner" };
const AUDITOR = { Authorization: "Bearer dev-auditor" };

async function start() {
  pool = createPoolFromUrl("pglite:memory");
  await applyMigrations(pool);
  await seedPlant(pool);
  app = await build(pool);
  return app;
}

afterEach(async () => {
  if (app) {
    await app.close();
    app = undefined;
  }
  if (pool) {
    await pool.end();
    pool = undefined;
  }
});

// Importing app.js pulls in db.js, which opens the on-disk default pool. Close
// it so the test process can exit cleanly (the tests never use it).
after(async () => {
  await defaultPool.end();
});

test("GET /health is ok", async () => {
  const a = await start();
  const res = await a.inject({ method: "GET", url: "/health" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ok, true);
});

test("v1 requires a bearer token (401 without one)", async () => {
  const a = await start();
  const res = await a.inject({ method: "GET", url: "/v1/floor" });
  assert.equal(res.statusCode, 401);
});

test("GET /v1/me returns identity and capability map", async () => {
  const a = await start();
  const res = await a.inject({ method: "GET", url: "/v1/me", headers: OPERATOR });
  assert.equal(res.statusCode, 200);
  const me = res.json();
  assert.equal(me.userId, "U-OP-1");
  assert.equal(me.plantId, "PL-RIVERBEND");
  assert.equal(me.role, "operator");
  assert.equal(me.can["run.write"], true);
  assert.equal(me.can["tape.read"], false);
});

test("GET /v1/floor returns populated assets and work orders", async () => {
  const a = await start();
  const res = await a.inject({ method: "GET", url: "/v1/floor", headers: OPERATOR });
  assert.equal(res.statusCode, 200);
  const floor = res.json();
  assert.equal(floor.plant.id, "PL-RIVERBEND");
  assert.ok(floor.assets.length >= 3, "expected at least 3 assets");
  assert.ok(floor.workOrders.length >= 1, "expected at least 1 work order");
  assert.ok(floor.operations.length >= 1, "expected at least 1 operation");
  assert.ok(floor.shifts.length >= 1, "expected at least 1 shift");
  const running = floor.assets.find((a2: { id: string }) => a2.id === "M-PRESS-01");
  assert.ok(running.openRun, "M-PRESS-01 should have an open run from seed");
  const goodQty = floor.workOrders[0].goodQty;
  assert.equal(goodQty, 100, "seed good qty for WO-26-0841 is 100");
});

test("GET /v1/plants/:p/assets/:a/live returns open run/downtime", async () => {
  const a = await start();
  const res = await a.inject({
    method: "GET",
    url: "/v1/plants/PL-RIVERBEND/assets/M-PRESS-01/live",
    headers: OPERATOR,
  });
  assert.equal(res.statusCode, 200);
  const live = res.json();
  assert.equal(live.assetId, "M-PRESS-01");
  assert.ok(live.openRun, "seed leaves M-PRESS-01 with an open run");
  assert.equal(live.openDowntime, null);
});

test("GET /v1/plants/:p/assets/:a/live rejects a foreign plant", async () => {
  const a = await start();
  const res = await a.inject({
    method: "GET",
    url: "/v1/plants/OTHER/assets/M-PRESS-01/live",
    headers: OPERATOR,
  });
  assert.equal(res.statusCode, 403);
});

test("GET /v1/work-orders/:id/timeline returns events", async () => {
  const a = await start();
  const res = await a.inject({
    method: "GET",
    url: "/v1/work-orders/WO-26-0841/timeline",
    headers: OPERATOR,
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.workOrderId, "WO-26-0841");
  assert.ok(body.events.length >= 1, "expected events on the timeline");
});

test("GET /v1/tape is auditor-only (403 for operator, 200 for auditor)", async () => {
  const a = await start();
  const denied = await a.inject({ method: "GET", url: "/v1/tape", headers: OPERATOR });
  assert.equal(denied.statusCode, 403);

  const allowed = await a.inject({ method: "GET", url: "/v1/tape", headers: AUDITOR });
  assert.equal(allowed.statusCode, 200);
  const tape = allowed.json();
  assert.ok(Array.isArray(tape.events), "expected an events array");
  assert.ok(tape.events.length >= 1, "seed produces events");
});

test("GET /v1/metrics/oee requires from and to (400), then returns assets", async () => {
  const a = await start();
  const noRange = await a.inject({ method: "GET", url: "/v1/metrics/oee", headers: OPERATOR });
  assert.equal(noRange.statusCode, 400);

  const from = new Date(Date.now() - 6 * 3600_000).toISOString();
  const to = new Date().toISOString();
  const ok = await a.inject({
    method: "GET",
    url: `/v1/metrics/oee?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    headers: OPERATOR,
  });
  assert.equal(ok.statusCode, 200);
  const oee = ok.json();
  assert.ok(oee.assets.length >= 1, "expected per-asset OEE rows");
});

test("GET /v1/export/events.csv streams the event tape as CSV", async () => {
  const a = await start();
  const res = await a.inject({ method: "GET", url: "/v1/export/events.csv", headers: OPERATOR });
  assert.equal(res.statusCode, 200);
  assert.ok((res.headers["content-type"] as string).includes("text/csv"));
  assert.match(res.body, /event_id,type,schema_version/);
});

test("POST /v1/catalog/shifts is planner-only", async () => {
  const a = await start();
  const denied = await a.inject({
    method: "POST",
    url: "/v1/catalog/shifts",
    headers: SUPERVISOR,
    payload: { code: "D", name: "Swing" },
  });
  assert.equal(denied.statusCode, 403);

  const created = await a.inject({
    method: "POST",
    url: "/v1/catalog/shifts",
    headers: PLANNER,
    payload: { code: "D", name: "Swing", startsAt: "14:00", endsAt: "22:00" },
  });
  assert.equal(created.statusCode, 200);
  assert.equal(created.json().id, "SHIFT-D");
});

test("other catalog writes are planner-only via HTTP", async () => {
  const a = await start();
  const denied = await a.inject({
    method: "POST",
    url: "/v1/catalog/assets",
    headers: OPERATOR,
    payload: { code: "X", name: "nope" },
  });
  assert.equal(denied.statusCode, 403);
});