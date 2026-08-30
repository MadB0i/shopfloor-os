const plantEl = document.querySelector("#plant");
const clockEl = document.querySelector("#clock");
const linkEl = document.querySelector("#link");
const handoffEl = document.querySelector("#handoff");
const assetsEl = document.querySelector("#assets");
const tapeEl = document.querySelector("#tape");
const selectedEl = document.querySelector("#selected");
const opEl = document.querySelector("#op");
const qtyEl = document.querySelector("#qty");
const scrapEl = document.querySelector("#scrapReason");
const downEl = document.querySelector("#downReason");
const faultEl = document.querySelector("#fault");

const whoamiEl = document.querySelector("#whoami");
const whoRoleEl = document.querySelector("#whoRole");
const whoNameEl = document.querySelector("#whoName");
const pickerEl = document.querySelector("#picker");
const pickerGridEl = document.querySelector("#pickerGrid");
const pickerFaultEl = document.querySelector("#pickerFault");
const customTokenEl = document.querySelector("#customToken");
const customApplyEl = document.querySelector("#customApply");

// Seeded demo identities. These are the default dev tokens (see .env.example /
// docker-compose.yml) mapped to the users seeded in seed-plant.ts. The static
// bearer-token model is intentional for the demo — this is a picker, not auth.
const IDENTITIES = [
  { token: "dev-operator", role: "operator", name: "Rina", note: "records runs, qty, downtime" },
  { token: "dev-supervisor", role: "supervisor", name: "Kamal", note: "accepts / overrides handoff" },
  { token: "dev-planner", role: "planner", name: "Meera", note: "runs floor + writes catalog" },
  { token: "dev-auditor", role: "auditor", name: "Audit desk", note: "read-only, full tape" },
];

let selectedAsset = null;
let floor = null;
let oeeById = {};
let me = null; // { userId, role, plantId, can } from GET /v1/me

function getToken() {
  return localStorage.getItem("sfos.token") || "";
}

function oeeCell(n) {
  return n == null || Number.isNaN(n) ? "—" : Number(n).toFixed(3);
}

function tick() {
  const now = new Date();
  const t = now.toTimeString().slice(0, 8);
  clockEl.textContent = t;
  clockEl.dateTime = now.toISOString();
}

setInterval(tick, 1000);
tick();

function authHeaders() {
  return {
    Authorization: `Bearer ${getToken()}`,
    "Content-Type": "application/json",
  };
}

// ── Identity picker ─────────────────────────────────────────────────────────

function renderPicker() {
  pickerGridEl.replaceChildren();
  const current = getToken();
  for (const id of IDENTITIES) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "picker-card";
    if (id.token === current) card.dataset.current = "true";
    card.innerHTML = `
      <span class="picker-role">${id.role.toUpperCase()}</span>
      <span class="picker-name">${id.name}</span>
      <span class="picker-note">${id.note}</span>
      <span class="picker-token">${id.token}</span>
    `;
    card.addEventListener("click", () => setIdentity(id.token));
    pickerGridEl.append(card);
  }
}

function showPicker(message) {
  renderPicker();
  pickerFaultEl.hidden = !message;
  if (message) pickerFaultEl.textContent = message;
  customTokenEl.value = "";
  pickerEl.hidden = false;
}

function hidePicker() {
  pickerEl.hidden = true;
  pickerFaultEl.hidden = true;
}

function setIdentity(token) {
  const trimmed = (token || "").trim();
  if (!trimmed) return;
  localStorage.setItem("sfos.token", trimmed);
  me = null;
  hidePicker();
  load();
}

function renderIdentity() {
  const token = getToken();
  const known = IDENTITIES.find((i) => i.token === token);
  const role = me?.role || known?.role || "";
  const name = known?.name || me?.userId || "—";
  whoRoleEl.textContent = role ? role.toUpperCase() : "—";
  whoNameEl.textContent = name;
  whoamiEl.dataset.role = role;
}

// Show/hide command buttons to mirror the backend capability map from /v1/me.
// Each button's capability: handoff accept/override need "handoff.resolve";
// everything else is a "run.write". Auditor has neither, so its pads vanish.
function applyRole() {
  const cap = me?.can || {};
  for (const btn of document.querySelectorAll(".pads button[data-cmd]")) {
    const cmd = btn.dataset.cmd;
    const needed = cmd === "handoff.accept" || cmd === "handoff.override" ? "handoff.resolve" : "run.write";
    btn.hidden = !cap[needed];
  }
}

whoamiEl.addEventListener("click", () => showPicker());
customApplyEl.addEventListener("click", () => setIdentity(customTokenEl.value));
customTokenEl.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") setIdentity(customTokenEl.value);
});

// ── Board ────────────────────────────────────────────────────────────────────

async function load() {
  if (!getToken()) {
    linkEl.dataset.state = "off";
    showPicker();
    return;
  }
  try {
    const meRes = await fetch("/v1/me", { headers: authHeaders() });
    if (meRes.status === 401 || meRes.status === 403) {
      linkEl.dataset.state = "off";
      me = null;
      renderIdentity();
      showPicker("Unknown token — pick a seeded identity or paste a valid one.");
      return;
    }
    if (meRes.ok) {
      me = await meRes.json();
      renderIdentity();
      applyRole();
    }

    const res = await fetch("/v1/floor", { headers: authHeaders() });
    if (!res.ok) {
      linkEl.dataset.state = "off";
      throw new Error(await res.text());
    }
    floor = await res.json();
    linkEl.dataset.state = "ok";
    plantEl.textContent = `${floor.plant.id}  ${floor.plant.name}`;
    if (floor.handoff?.pending) {
      handoffEl.dataset.state = "wait";
      handoffEl.textContent = `HO ${floor.handoff.fromShift}>${floor.handoff.toShift}`;
    } else {
      handoffEl.dataset.state = "ok";
      handoffEl.textContent = "SHIFT";
    }
    oeeById = {};
    const until = new Date();
    const since = new Date(until);
    since.setHours(0, 0, 0, 0);
    const oeeRes = await fetch(
      `/v1/metrics/oee?from=${encodeURIComponent(since.toISOString())}&to=${encodeURIComponent(until.toISOString())}`,
      { headers: authHeaders() },
    );
    if (oeeRes.ok) {
      const body = await oeeRes.json();
      oeeById = Object.fromEntries((body.assets || []).map((s) => [s.assetId, s]));
    }
    renderAssets();
    renderJobs();
    renderOps();
    renderReasons();
    renderTape();
    faultEl.hidden = true;
  } catch (err) {
    linkEl.dataset.state = "off";
    showFault(err);
  }
}

function renderAssets() {
  assetsEl.replaceChildren();
  for (const a of floor.assets) {
    const card = document.createElement("article");
    card.className = "asset";
    card.tabIndex = 0;
    card.ariaSelected = a.id === selectedAsset ? "true" : "false";
    card.addEventListener("click", () => {
      selectedAsset = a.id;
      selectedEl.textContent = a.id;
      renderAssets();
    });
    const runOn = Boolean(a.openRun);
    const downOn = Boolean(a.openDowntime);
    const s = oeeById[a.id];
    card.innerHTML = `
      <div class="code">${a.code}</div>
      <div class="name">${a.name}</div>
      <div class="lamps">
        <div class="lamp ${runOn ? "on-run" : ""}">RUN</div>
        <div class="lamp ${downOn ? "on-down" : ""}">DOWN</div>
      </div>
      <div class="ticket">${a.openRun ? `${a.openRun.workOrderId || "OPEN RUN"}${a.openRun.paused ? "  HOLD" : ""}` : "IDLE"}</div>
      <div class="oee">A ${oeeCell(s?.availability)}  P ${oeeCell(s?.performance)}  Q ${oeeCell(s?.quality)}  OEE ${oeeCell(s?.oee)}</div>
    `;
    assetsEl.append(card);
  }
  if (!selectedAsset && floor.assets[0]) {
    selectedAsset = floor.assets[0].id;
    selectedEl.textContent = selectedAsset;
  }
}

function renderJobs() {
  const el = document.querySelector("#jobCards");
  el.replaceChildren();
  for (const wo of floor.workOrders) {
    const card = document.createElement("article");
    card.className = "jobcard";

    const good = wo.goodQty ?? 0;
    const target = wo.target_qty ?? 0;
    const pct = target > 0 ? Math.min(100, Math.round((good / target) * 100)) : 0;

    let status = "IDLE";
    let statusCls = "idle";
    let opName = "";
    let assetCode = "";
    for (const a of floor.assets) {
      if (a.openRun && a.openRun.workOrderId === wo.id) {
        const op = floor.operations.find((o) => o.id === a.openRun.operationId);
        opName = op ? `OP-${op.seq} ${op.name}` : a.openRun.operationId;
        assetCode = a.code;
        if (a.openRun.paused) {
          status = "PAUSED";
          statusCls = "paused";
        } else {
          status = "RUNNING";
          statusCls = "running";
        }
        break;
      }
    }
    if (status === "IDLE") {
      const lastOp = floor.operations.filter((o) => o.work_order_id === wo.id).sort((a, b) => b.seq - a.seq)[0];
      opName = lastOp ? `OP-${lastOp.seq} ${lastOp.name}` : "";
    }

    card.innerHTML = `
      <div class="jobhead">
        <span class="jocode">${wo.code}</span>
        <span class="jostatus ${statusCls}">${status}</span>
      </div>
      <div class="joop">${opName}${assetCode ? " on " + assetCode : ""}</div>
      <div class="joprogress">
        <div class="jobar"><div class="jofill ${statusCls}" style="width:${pct}%"></div></div>
        <span class="joqty">${good} / ${target}</span>
      </div>
    `;
    el.append(card);
  }
}

function renderOps() {
  opEl.replaceChildren();
  for (const op of floor.operations) {
    const opt = document.createElement("option");
    opt.value = JSON.stringify({
      workOrderId: op.work_order_id,
      operationId: op.id,
    });
    opt.textContent = `${op.work_order_code} / ${op.seq} ${op.name}`;
    opEl.append(opt);
  }
}

function renderReasons() {
  scrapEl.replaceChildren();
  downEl.replaceChildren();
  for (const r of floor.reasonCodes) {
    const opt = document.createElement("option");
    opt.value = r.code;
    opt.textContent = `${r.code} ${r.label}`;
    if (r.kind === "scrap") scrapEl.append(opt);
    if (r.kind === "downtime") downEl.append(opt);
  }
}

function renderTape() {
  tapeEl.replaceChildren();
  for (const ev of floor.tape) {
    const li = document.createElement("li");
    const when = new Date(ev.occurred_at).toTimeString().slice(0, 8);
    li.innerHTML = `<span class="when">${when}</span><span class="kind">${ev.type}${ev.voided ? " VOID" : ""}</span><span>${ev.asset_id || "PLANT"} ${ev.work_order_id || ""}</span>`;
    tapeEl.append(li);
  }
}

function showFault(err) {
  faultEl.hidden = false;
  faultEl.textContent = err instanceof Error ? err.message : String(err);
}

function woOp() {
  return JSON.parse(opEl.value);
}

const bodies = {
  "run.start": () => ({ assetId: selectedAsset, ...woOp() }),
  "run.complete": () => ({ assetId: selectedAsset }),
  "run.pause": () => ({ assetId: selectedAsset }),
  "run.resume": () => ({ assetId: selectedAsset }),
  "qty.good": () => ({ assetId: selectedAsset, ...woOp(), qty: Number(qtyEl.value) }),
  "qty.scrap": () => ({
    assetId: selectedAsset,
    ...woOp(),
    qty: Number(qtyEl.value),
    reasonCode: scrapEl.value,
  }),
  "downtime.start": () => ({ assetId: selectedAsset, reasonCode: downEl.value }),
  "downtime.end": () => ({ assetId: selectedAsset }),
  "handoff.submit": () => ({ fromShift: "A", toShift: "B", note: "board" }),
  "handoff.accept": () => ({ fromShift: "A", toShift: "B" }),
  "handoff.override": () => ({ fromShift: "A", toShift: "B", reason: "board" }),
};

document.querySelector(".pads").addEventListener("click", async (ev) => {
  const btn = ev.target.closest("button[data-cmd]");
  if (!btn || !selectedAsset) return;
  const cmd = btn.dataset.cmd;
  // Mirror the backend guard client-side too — the button is hidden for roles
  // that lack the capability, but never trust the DOM alone.
  const needed = cmd === "handoff.accept" || cmd === "handoff.override" ? "handoff.resolve" : "run.write";
  if (me && me.can && !me.can[needed]) {
    showFault(new Error(`${me.role} cannot ${cmd}`));
    return;
  }
  try {
    const res = await fetch(`/v1/commands/${cmd}`, {
      method: "POST",
      headers: {
        ...authHeaders(),
        "Idempotency-Key": `${cmd}:${selectedAsset}:${Date.now()}`,
      },
      body: JSON.stringify(bodies[cmd]()),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    faultEl.hidden = true;
    await load();
  } catch (err) {
    showFault(err);
  }
});

setInterval(load, 2500);
load();
