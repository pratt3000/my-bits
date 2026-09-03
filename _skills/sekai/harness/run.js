/**
 * Drive a bit headlessly in Chromium and report whether it actually runs.
 *
 *   node harness/run.js <path/to/bit-dir> [scenario.json]
 *
 * Checks: no console/page/init errors, ready() called, frames advancing, the
 * canvas is not a flat single colour, and every gesture in the scenario lands.
 *
 * The ctx it hands the bit is deliberately stricter than the runtime is
 * forgiving: anything sdk.md does not document is absent, so calling it throws
 * here rather than on someone's phone. Screenshots land in shots/<bit>/ — read
 * them, because a bit can run clean and still look wrong, and the console will
 * never tell you that.
 */
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const bitArg = process.argv[2];
const scenarioPath = process.argv[3];
if (!bitArg) { console.error("usage: run.js <path/to/bit-dir> [scenario.json]"); process.exit(2); }

const bitDir = path.resolve(bitArg);
const bit = path.basename(bitDir);
const REPO = path.dirname(bitDir);
const OUT = process.env.BIT_OUT || path.join(process.cwd(), "shots");
const SHOTS = path.join(OUT, bit);
fs.mkdirSync(SHOTS, { recursive: true });

const manifest = JSON.parse(fs.readFileSync(path.join(bitDir, "plethora.json"), "utf8"));

// three is fetched on demand rather than committed - it is 1.2 MB.
const VENDOR = path.join(__dirname, "vendor");
const needsThree = (manifest.dependencies || []).some((d) => String(d).startsWith("three@"));
if (needsThree && !fs.existsSync(path.join(VENDOR, "three.module.js"))) {
  const version = String((manifest.dependencies || []).find((d) => String(d).startsWith("three@"))).split("@")[1];
  fs.mkdirSync(VENDOR, { recursive: true });
  console.log("fetching three@" + version + " for the harness...");
  require("child_process").execFileSync("curl", ["-sSL", "-o", path.join(VENDOR, "three.module.js"),
    "https://libs.plethora.studio/three/" + version + "/three.module.js"], { stdio: "inherit" });
}
const scenario = scenarioPath ? JSON.parse(fs.readFileSync(scenarioPath, "utf8")) : { steps: [{ wait: 2500 }] };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, "serve.js")],
    { stdio: "ignore", env: Object.assign({}, process.env, { BIT_ROOT: REPO }) });
  await sleep(500);

  const browser = await chromium.launch({
    args: [
      "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
      "--enable-webgl", "--ignore-gpu-blocklist", "--disable-lcd-text"
    ]
  });
  const page = await browser.newPage({
    viewport: scenario.viewport || { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true
  });

  const problems = [];
  page.on("console", (m) => {
    const t = m.type();
    if (t === "error" || t === "warning") {
      const text = m.text();
      // three prints an informational banner-free warning for missing extensions
      // on swiftshader; that is the harness, not the bit.
      if (/THREE.WebGLRenderer: (EXT|OES|WEBGL)/.test(text)) return;
      if (/GL Driver Message|GPU stall|Automatic fallback to software|swiftshader/i.test(text)) return;
      problems.push("console." + t + ": " + text);
    }
  });
  page.on("pageerror", (e) => problems.push("pageerror: " + (e.stack || e.message)));

  if (scenario.seed) {
    await page.addInitScript((d) => { window.__seedData = d; }, scenario.seed);
  }
  if (scenario.offline) {
    await page.addInitScript(() => { window.__worldOffline = true; });
  }
  if (scenario.caps) {
    await page.addInitScript((c) => { window.__caps = c; }, scenario.caps);
  }

  const url = "http://127.0.0.1:8791/harness/host.html?bit=" + bit +
    "&manifest=" + encodeURIComponent(JSON.stringify(manifest));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction("window.__booted === true", null, { timeout: 30000 })
    .catch(() => problems.push("boot: init never resolved"));

  const shot = async (name, clip) => {
    await page.screenshot(clip ? { path: path.join(SHOTS, name + ".png"), clip: clip }
                               : { path: path.join(SHOTS, name + ".png") });
  };

  // --- gesture primitives ---------------------------------------------------
  async function down(x, y) { await page.mouse.move(x, y); await page.mouse.down(); }
  async function up(x, y) { if (x != null) await page.mouse.move(x, y); await page.mouse.up(); }

  async function drag(points, ms) {
    const per = Math.max(8, (ms || 600) / Math.max(1, points.length));
    await down(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) {
      await page.mouse.move(points[i][0], points[i][1]);
      await sleep(per);
    }
    await up();
  }

  async function circle(o) {
    const { cx, cy, r, turns = 1, ms = 1600, dir = 1, steps = 48 } = o;
    const total = Math.round(steps * turns);
    const per = ms / total;
    const pt = (i) => [cx + Math.cos((i / steps) * Math.PI * 2 * dir - Math.PI / 2) * r,
                       cy + Math.sin((i / steps) * Math.PI * 2 * dir - Math.PI / 2) * r];
    await down(...pt(0));
    for (let i = 1; i <= total; i++) { await page.mouse.move(...pt(i)); await sleep(per); }
    await up();
  }

  async function zigzag(o) {
    const { x1, x2, y1, y2, n = 8, ms = 2000 } = o;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push([i % 2 ? x2 : x1, y1 + (y2 - y1) * t]);
    }
    await drag(pts, ms);
  }

  for (const step of scenario.steps) {
    try {
      if (step.wait) await sleep(step.wait);
      if (step.tap) { await page.mouse.click(step.tap[0], step.tap[1]); await sleep(step.after || 250); }
      if (step.press) { await down(step.press[0], step.press[1]); await sleep(step.hold || 900); await up(); }
      // held gestures, so a scenario can screenshot mid-drag
      if (step.down) { await down(step.down[0], step.down[1]); await sleep(step.after || 120); }
      if (step.moveTo) { await page.mouse.move(step.moveTo[0], step.moveTo[1]); await sleep(step.after || 120); }
      if (step.up) { await page.mouse.up(); await sleep(step.after || 120); }
      if (step.drag) await drag(step.drag, step.ms);
      if (step.circle) await circle(step.circle);
      if (step.zigzag) await zigzag(step.zigzag);
      if (step.eval) await page.evaluate(step.eval);
      if (step.screenshot) await shot(step.screenshot, step.clip);
      if (step.expectEvent) {
        const found = await page.evaluate((k) => window.__bitEvents.some((e) => e.kind === k), step.expectEvent);
        if (!found) problems.push("expected platform event never fired: " + step.expectEvent);
      }
      if (step.resize) { await page.setViewportSize({ width: step.resize[0], height: step.resize[1] }); await sleep(600); }
    } catch (e) {
      problems.push("step " + JSON.stringify(step).slice(0, 80) + " failed: " + e.message);
    }
  }

  // --- health checks ---------------------------------------------------------
  const state = await page.evaluate(() => ({
    errors: window.__bitErrors,
    ready: !!window.__ready,
    frames: window.__frames || 0,
    events: window.__bitEvents.map((e) => e.kind)
  }));
  problems.push(...state.errors);
  if (!state.ready) problems.push("ctx.platform.ready() was never called");
  if (state.frames < 30) problems.push("frame loop barely ran: " + state.frames + " frames");

  // Is the canvas actually painting something? Compare two frames + check the
  // picture is not one flat colour.
  const a = await page.screenshot();
  await sleep(500);
  const b = await page.screenshot();
  if (Buffer.compare(a, b) === 0) problems.push("two frames 500ms apart are byte-identical (nothing is animating)");

  const variety = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll("canvas"));
    return cs.map((c) => {
      try {
        if (c.__glOwned || (window.__glCanvases || []).includes(c)) return { kind: "gl", colours: -1 };
        const g = c.getContext("2d");
        const d = g.getImageData(0, 0, Math.min(64, c.width), Math.min(64, c.height)).data;
        const set = new Set();
        for (let i = 0; i < d.length; i += 4) set.add(d[i] + "," + d[i + 1] + "," + d[i + 2]);
        return { kind: "2d", colours: set.size };
      } catch (e) { return { kind: "err", colours: -1, msg: String(e) }; }
    });
  });

  await shot("final");
  const counts = await page.evaluate(() => {
    const o = {};
    for (const e of window.__bitEvents) o[e.kind] = (o[e.kind] || 0) + 1;
    return o;
  });

  await browser.close();
  server.kill();

  console.log("\n=== " + bit + " ===");
  console.log("frames:", state.frames, " canvases:", JSON.stringify(variety));
  console.log("platform events:", JSON.stringify(counts));
  if (problems.length) {
    console.log("\nPROBLEMS (" + problems.length + "):");
    for (const p of problems.slice(0, 40)) console.log("  - " + p);
    process.exit(1);
  }
  console.log("\nOK — no errors. shots in " + SHOTS);
})().catch((e) => { console.error(e); process.exit(1); });
