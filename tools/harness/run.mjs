/*
 * Plays a bit in headless Chromium so its mechanics can be verified before
 * upload — the real runtime only exists inside the Plethora app.
 *
 * The interesting part is multi-touch. Every bit in this batch is local
 * multiplayer: several people press the same screen at the same instant, and
 * the bugs live exactly there (a second finger stealing the first one's
 * pointer, a corner button eating a neighbour's tap). Playwright's touchscreen
 * is single-pointer, so touches go through CDP Input.dispatchTouchEvent, which
 * takes a full touch-point list and can hold N fingers down at once.
 */
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { readFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { resolve, basename, extname, join } from "node:path";
import { createServer } from "node:http";

// Playwright is installed globally in this environment and ESM import does not
// consult NODE_PATH, so resolve it through the CJS loader against `npm root -g`.
// That keeps the harness runnable with no local install step.
const require = createRequire(import.meta.url);
const globalModules = execSync("npm root -g", { encoding: "utf8" }).trim();
const { chromium } = require(`${globalModules}/playwright`);

const HARNESS = resolve(import.meta.dirname);

export async function openBit(dir, opts = {}) {
  const viewport = opts.viewport || { width: 390, height: 844 };   // iPhone 14
  const manifest = JSON.parse(readFileSync(`${dir}/plethora.json`, "utf8"));
  const bitDir = resolve(dir);

  const html = readFileSync(`${HARNESS}/host.html`, "utf8")
    .replace("__MANIFEST__", JSON.stringify(manifest))
    .replace("__SAFEAREA__", JSON.stringify(opts.safeArea || { top: 47, bottom: 34, left: 0, right: 0 }))
    .replace("__LIBS__", JSON.stringify({
      // Exact registry builds, sha256-verified against libraries.json. The
      // sandbox has no network, so these are served off disk instead.
      "three@0.164.1": "/libcache/three.module.js",
    }))
    .replace("__ENTRY__", "/bit/main.js");

  // Served over HTTP rather than file://, because ES module imports from a
  // file:// origin are blocked by CORS and every 3D bit needs importModule.
  const MIME = { ".js": "text/javascript", ".html": "text/html", ".json": "application/json" };
  const server = createServer((req, res) => {
    const url = req.url.split("?")[0];
    let file = null;
    if (url === "/" || url === "/host.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(html);
    }
    if (url.startsWith("/bit/")) file = join(bitDir, url.slice(5));
    else file = join(HARNESS, url.slice(1));
    if (!file.startsWith(bitDir) && !file.startsWith(HARNESS)) { res.writeHead(403); return res.end(); }
    if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const browser = await chromium.launch({
    executablePath: process.env.PLETHORA_CHROME || "/opt/pw-browsers/chromium",
    args: [
      "--no-sandbox",
      "--font-render-hinting=none",
      // Headless has no GPU, so WebGL runs on SwiftShader. Slower than a
      // phone but pixel-accurate, which is what a screenshot review needs.
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
    ],
  });
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: opts.dpr || 2,
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", e => consoleErrors.push("pageerror: " + e.message));

  const cdp = await context.newCDPSession(page);
  await page.goto(origin);
  await page.waitForFunction(() => window.__BIT_INITED__ !== undefined, { timeout: 20000 })
    .catch(() => {});

  // ---- multi-touch, held across calls so N fingers can overlap ----
  const down = new Map();                    // id -> {x, y}
  const pts = () => [...down.entries()].map(([id, p]) => ({ x: p.x, y: p.y, id }));
  async function send(type, changed) {
    await cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? changed : pts(),
      modifiers: 0,
    });
  }

  const api = {
    page, browser, context, cdp, consoleErrors, viewport,

    /** Press a finger down and leave it down. */
    async fingerDown(id, x, y) {
      down.set(id, { x, y });
      await send("touchStart");
    },
    /** Move a finger that is already down. */
    async fingerMove(id, x, y) {
      if (!down.has(id)) throw new Error(`finger ${id} is not down`);
      down.set(id, { x, y });
      await send("touchMove");
    },
    /** Lift one finger. */
    async fingerUp(id) {
      const p = down.get(id);
      if (!p) throw new Error(`finger ${id} is not down`);
      down.delete(id);
      await send("touchEnd", [{ x: p.x, y: p.y, id }]);
    },
    /** A complete one-finger tap. */
    async tap(x, y, id = 1) {
      await api.fingerDown(id, x, y);
      await api.wait(40);
      await api.fingerUp(id);
    },
    /** Several fingers landing in the same frame — the multiplayer case. */
    async tapTogether(points) {
      for (const [i, p] of points.entries()) down.set(100 + i, { x: p.x, y: p.y });
      await send("touchStart");
      await api.wait(40);
      for (const [i, p] of points.entries()) {
        down.delete(100 + i);
        await send("touchEnd", [{ x: p.x, y: p.y, id: 100 + i }]);
      }
    },
    /** Drag one finger along a path. */
    async drag(from, to, { steps = 18, id = 1, holdMs = 0 } = {}) {
      await api.fingerDown(id, from.x, from.y);
      for (let i = 1; i <= steps; i++) {
        await api.fingerMove(id, from.x + (to.x - from.x) * i / steps,
                                 from.y + (to.y - from.y) * i / steps);
        await api.wait(12);
      }
      if (holdMs) await api.wait(holdMs);
      await api.fingerUp(id);
    },

    wait: (ms) => page.waitForTimeout(ms),

    /** Everything the bit told the platform, in order. */
    events: () => page.evaluate(() => window.__BIT_LOG__.map(e => ({ kind: e.kind, args: e.args }))),
    eventKinds: () => page.evaluate(() => window.__BIT_EVENTS__.slice()),
    errors: async () => [
      ...(await page.evaluate(() => window.__BIT_ERRORS__.slice())),
      ...consoleErrors,
    ],
    /** Read state the bit chose to expose for testing. */
    probe: (fn, ...args) => page.evaluate(fn, ...args),

    async shot(name) {
      const out = resolve(opts.outDir || `${HARNESS}/shots`);
      mkdirSync(out, { recursive: true });
      const file = `${out}/${name}.png`;
      await page.screenshot({ path: file });
      return file;
    },

    close: async () => { await browser.close(); server.close(); },
  };
  return api;
}

// CLI: node run.mjs <bit-dir> [--shot name] [--ms 1500]
if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2];
  const ms = Number((process.argv.find(a => a.startsWith("--ms")) || "--ms=1500").split("=")[1] || 1500);
  const bit = await openBit(dir);
  await bit.wait(ms);
  const errs = await bit.errors();
  const kinds = await bit.eventKinds();
  const shot = await bit.shot(basename(dir) + "-boot");
  console.log(`events: ${[...new Set(kinds)].join(", ") || "(none)"}`);
  console.log(`ready:  ${kinds.includes("ready") ? "yes" : "NO — bit never called ctx.platform.ready()"}`);
  if (errs.length) { console.log("ERRORS:"); errs.forEach(e => console.log("  " + e)); }
  else console.log("errors: none");
  console.log(`shot:   ${shot}`);
  await bit.close();
  process.exit(errs.length ? 1 : 0);
}
