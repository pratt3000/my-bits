// Render a GLB from two angles and print its mesh/triangle/part breakdown.
import { chromium } from "/tmp/claude-0/-home-user-my-bits/1b040449-f8b6-5bc0-9de4-2b105cb7a462/scratchpad/node_modules/playwright/index.mjs";
const glb = process.argv[2];
const out = process.argv[3] || "shot.png";
const port = process.argv[4] || "5288";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 960, height: 480 }, deviceScaleFactor: 1 });
const errs = [];
p.on("pageerror", e => errs.push(e.message));
await p.goto(`http://127.0.0.1:${port}/viewer/index.html?glb=${encodeURIComponent(glb)}&w=480&h=480`);
await p.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
const stats = await p.evaluate(() => window.__stats);
await p.screenshot({ path: out });
console.log(JSON.stringify(stats, null, 0));
if (errs.length) console.log("ERRORS:", errs.slice(0, 3).join("; "));
await b.close();
