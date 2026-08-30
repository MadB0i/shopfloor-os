const tokenEl = document.querySelector("#token");
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

const stored = localStorage.getItem("sfos.token") || "dev-operator";
tokenEl.value = stored;

let selectedAsset = null;
let floor = null;
let oeeById = {};

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

tokenEl.addEventListener("change", () => {
  localStorage.setItem("sfos.token", tokenEl.value.trim());
  load();
});

function authHeaders() {
  return {
    Authorization: `Bearer ${tokenEl.value.trim()}`,
    "Content-Type": "application/json",
  };
}

async function load() {
  try {
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
  const token = localStorage.getItem("sfos.token") || tokenEl.value.trim();
  if (tokenEl.value.trim() !== token) localStorage.setItem("sfos.token", tokenEl.value.trim());
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
