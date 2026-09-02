// Capture the shot list. Uses the plain static server rather than vite, so the
// project needs no bundler; the importmap in index.html does the resolving.
import { chromium } from "/tmp/claude-0/-home-user-my-bits/1b040449-f8b6-5bc0-9de4-2b105cb7a462/scratchpad/node_modules/playwright/index.mjs";
import fs from "node:fs";
import { SHOTS } from "./shots.js";

const port = process.env.PORT || "5288";
const out = process.argv[2] || "shots/latest";
const only = process.argv[3];
fs.mkdirSync(out, { recursive: true });

const b = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--force-device-scale-factor=1"]
});
const names = only ? [only] : Object.keys(SHOTS);
const report = [];
for (const name of names) {
  const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  p.on("console", m => { if (m.type() === "error") errs.push("console: " + m.text()); });
  const url = `http://127.0.0.1:${port}/index.html?capture=1&lockstep=1&q=high&shot=${name}`;
  let ok = true, note = "";
  try {
    await p.goto(url, { timeout: 45000 });
    await p.waitForFunction(() => window.__READY__ === true, null, { timeout: 60000 });
  } catch (e) { ok = false; note = String(e).split("\n")[0]; }
  // Present a frame immediately before the shutter. Without this the canvas
  // has preserveDrawingBuffer:false and the screenshot catches a discarded
  // buffer — which reads as a black frame with the DOM HUD still on top.
  await p.evaluate(() => window.__PRESENT__?.(1)).catch(() => {});
  const file = `${out}/${name}.png`;
  await p.screenshot({ path: file });
  // Blank-frame detection: a lost context writes a uniform PNG with ok:true,
  // and a reviewer then critiques an empty image for a whole round.
  const stats = await p.evaluate(() => {
    const c = document.getElementById("game");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    return { lost: !gl || gl.isContextLost(), w: c.width, h: c.height,
             calls: window.__ENGINE__?.registry?.peek?.("render")?.renderer?.info?.render?.calls ?? null,
             tris: window.__ENGINE__?.registry?.peek?.("render")?.renderer?.info?.render?.triangles ?? null };
  }).catch(() => ({ lost: true }));
  report.push({ name, ok, note, ...stats, errors: errs.slice(0, 2) });
  console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(14)} ${stats.lost ? "CONTEXT LOST " : ""}${stats.calls != null ? "calls=" + stats.calls + " tris=" + stats.tris : ""}${errs.length ? " ERR: " + errs[0].slice(0, 120) : ""}`);
  await p.close();
}
fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
await b.close();
