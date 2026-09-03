/**
 * Run a recovered game standalone and screenshot it.
 *
 *   node preview.js <recovered/original.html> [--shot out.png] [--wait ms]
 *
 * Worth doing before porting: it tells you the recovery is complete, and it
 * shows you what the thing is actually supposed to look like, which is hard to
 * infer from source. It also surfaces bugs that were already in the original —
 * an icon that never rendered, a control that throws — so you can decide
 * deliberately whether the port keeps them.
 *
 * The CDN libraries are vendored locally first, because sandboxes usually block
 * those hosts and a failed CDN load can abort the page's init and leave you
 * looking at a blank screen, concluding wrongly that the recovery failed.
 */
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "/opt/node22/lib/node_modules/playwright");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const args = process.argv.slice(2);
const file = args[0];
if (!file) { console.error("usage: preview.js <original.html> [--shot out.png] [--wait ms]"); process.exit(2); }
const shot = args.includes("--shot") ? args[args.indexOf("--shot") + 1] : path.join(path.dirname(file), "preview.png");
const wait = args.includes("--wait") ? Number(args[args.indexOf("--wait") + 1]) : 2500;

const dir = path.dirname(path.resolve(file));
const vendorDir = path.join(dir, "vendor");
let html = fs.readFileSync(file, "utf8");

// Pull every external script local so the page runs with no network.
const externals = [...html.matchAll(/<script[^>]*src="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
if (externals.length) fs.mkdirSync(vendorDir, { recursive: true });
for (const url of externals) {
  const name = url.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") + ".js";
  const dest = path.join(vendorDir, name);
  if (!fs.existsSync(dest)) {
    process.stdout.write("vendoring " + url + "\n");
    try { execFileSync("curl", ["-sSL", "-o", dest, url], { stdio: "inherit" }); }
    catch (e) { console.error("  could not fetch it; the preview may be incomplete"); continue; }
  }
  html = html.split(url).join("vendor/" + name);
}
const offline = path.join(dir, "offline-preview.html");
fs.writeFileSync(offline, html);

(async () => {
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
           "--autoplay-policy=no-user-gesture-required"],
  });
  const page = await browser.newPage({ viewport: { width: 420, height: 860 }, hasTouch: true, isMobile: true });

  const problems = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push("console: " + m.text()); });
  page.on("pageerror", (e) => problems.push("pageerror: " + (e.stack || e.message)));

  await page.goto("file://" + offline, { waitUntil: "load" });
  await page.waitForTimeout(wait);

  // Drag across the largest canvas, which is usually the thing you interact with.
  const canvas = await page.$("canvas");
  const box = canvas ? await canvas.boundingBox() : null;
  if (box) {
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.35);
    await page.mouse.down();
    for (let i = 0; i < 20; i++) {
      await page.mouse.move(box.x + box.width * (0.4 + i * 0.02), box.y + box.height * (0.35 + i * 0.015));
      await page.waitForTimeout(30);
    }
    await page.mouse.up();
    await page.waitForTimeout(400);
  }

  const state = await page.evaluate(() => ({
    canvases: document.querySelectorAll("canvas").length,
    controls: document.querySelectorAll("[data-mode],[data-lucide],button").length,
    globals: Object.keys(window).filter((k) => /^(app|game|sekai|synth|state)/i.test(k)),
  }));

  await page.screenshot({ path: shot });
  await browser.close();

  console.log("canvases  :", state.canvases);
  console.log("controls  :", state.controls);
  console.log("globals   :", state.globals.join(", ") || "(none matched)");
  console.log("screenshot:", shot);
  console.log(problems.length ? "\nerrors in the ORIGINAL (decide whether the port keeps them):\n  " +
    problems.join("\n  ") : "\nno console or page errors");
})();
