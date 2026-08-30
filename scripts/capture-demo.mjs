// Capture docs/screenshots/demo.gif source footage.
//
// Drives a realistic ~17s sequence on the live board (http://localhost:8787)
// and records it as a WebM via Playwright's built-in video recording.
// Convert to GIF with ffmpeg (palettegen/paletteuse) afterwards — see
// README or the commit message of the demo.gif commit.
//
// Prerequisites:
//   - the dev server running:  npm run b0 && npm start   (freshly seeded)
//   - system Chrome
//   - npm i --no-save playwright-core
//
// Usage:  node scripts/capture-demo.mjs <out-dir>
// The sequence assumes the freshly-seeded demo floor (pending handoff,
// open run + open downtime from the seed) — the script resets that state
// via the API before recording so the video starts from an idle board.

import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const BASE = "http://localhost:8787";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const outDir = process.argv[2] ?? "out-capture";
mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) return res.json();
  // 409 = the reset already happened (pre-flight is idempotent across reruns)
  if (res.status === 409) {
    console.log(`pre-flight ${path}: already in target state (409)`);
    return null;
  }
  throw new Error(`pre-flight ${path} failed: ${res.status} ${await res.text()}`);
}

// ── Pre-flight (off camera): reset the seeded floor to an idle board ────────
await api("/v1/commands/handoff.accept", "dev-supervisor", { fromShift: "A", toShift: "B" });
await api("/v1/commands/run.complete", "dev-operator", { assetId: "M-PRESS-01" });
await api("/v1/commands/downtime.end", "dev-operator", { assetId: "M-PRESS-02" });
console.log("pre-flight done: handoff cleared, press freed, downtime closed");

// ── Recorded sequence ────────────────────────────────────────────────────────
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  recordVideo: { dir: outDir, size: { width: 1600, height: 900 } },
});
const page = await context.newPage();

async function step(label, fn, pauseMs) {
  const t = ((Date.now() - t0) / 1000).toFixed(1);
  await fn();
  console.log(`  [${String(t).padStart(4)}s] ${label}`);
  await sleep(pauseMs);
}

const t0 = Date.now();
await page.goto(BASE, { waitUntil: "domcontentloaded" });

// 1. Identity picker: hold so the viewer reads it, then sign in as operator.
await page.waitForSelector(".picker-card");
await step("identity picker visible", () => {}, 1600);
await step("pick operator (Rina Okafor)", () => page.click('.picker-card:has-text("Rina Okafor")'), 1700);

// 2. Select the press, set a batch size worth seeing on the progress bar.
await step("select M-PRESS-01", () => page.click('.asset:has-text("PRESS-01")'), 1100);
await step("set QTY = 50", () => page.fill("#qty", "50"), 900);

// 3. RUN START — RUN lamp lights green, ticket appears.
await step("RUN START", () => page.click('button[data-cmd="run.start"]'), 1900);

// 4. Two GOOD+ clicks — job-card bar moves 20% → 30% → 40%.
await step("GOOD + (100 → 150)", () => page.click('button[data-cmd="qty.good"]'), 1500);
await step("GOOD + (150 → 200)", () => page.click('button[data-cmd="qty.good"]'), 1500);

// 5. Move to the pack bench and take it down — red lamp + glow.
await step("select M-PACK-01", () => page.click('.asset:has-text("PACK-01")'), 1100);
await step("DOWN START (WAIT-MATERIAL)", () => page.click('button[data-cmd="downtime.start"]'), 1900);

// 6. Finale: hand off the shift — pending-handoff lamp glows amber.
await step("HANDOFF OUT", () => page.click('button[data-cmd="handoff.submit"]'), 2600);

await page.close();
await context.close(); // flushes the video file
await browser.close();
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s — video in ${outDir}`);
