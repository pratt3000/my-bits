/**
 * Inline lucide icon geometry, so a bit does not need the 424 KB CDN script.
 *
 *   node icons.js activity radio gamepad-2 ...          # named icons
 *   node icons.js --from <inventory.json>               # every icon grab.py found
 *
 * Prints a JS object literal ready to paste into the bit as its ICONS table,
 * and writes icons.json beside the inventory. Icon geometry is lucide (ISC) —
 * keep the licence note in the ported bit's header.
 *
 * Names that lucide does not have are reported as MISSING rather than silently
 * skipped: a game that asks for an icon by the wrong name renders an empty
 * button, and the port is the moment to notice and fix that.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const CDN = "https://unpkg.com/lucide@latest";
const cacheDir = path.join(__dirname, "..", "harness", "vendor");
const cache = path.join(cacheDir, "lucide.js");

function bundle() {
  if (!fs.existsSync(cache)) {
    fs.mkdirSync(cacheDir, { recursive: true });
    process.stderr.write("fetching lucide...\n");
    execFileSync("curl", ["-sSL", "-o", cache, CDN], { stdio: ["ignore", "ignore", "inherit"] });
  }
  // UMD: with no `exports` and no `define`, it attaches itself to the global.
  const sandbox = { window: {}, self: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(cache, "utf8"), sandbox, { timeout: 30000 });
  const lucide = sandbox.lucide || (sandbox.globalThis && sandbox.globalThis.lucide) || sandbox.window.lucide;
  if (!lucide) throw new Error("lucide did not attach to the sandbox global");
  return lucide;
}

const pascal = (n) => n.split("-").map((p) => p[0].toUpperCase() + p.slice(1)).join("");

function geometry(icon) {
  // An icon is its array of child nodes: [[tag, attrs], ...]
  return icon.map(([tag, attrs]) =>
    "<" + tag + " " + Object.entries(attrs).map(([k, v]) => k + '="' + v + '"').join(" ") + "/>"
  ).join("");
}

let names = process.argv.slice(2);
let inventoryPath = null;
const fromIdx = names.indexOf("--from");
if (fromIdx !== -1) {
  inventoryPath = names[fromIdx + 1];
  names = JSON.parse(fs.readFileSync(inventoryPath, "utf8")).icons || [];
}
if (!names.length) { console.error("usage: node icons.js <name...> | --from <inventory.json>"); process.exit(2); }

const lucide = bundle();
const out = {};
const missing = [];
for (const name of names) {
  const icon = lucide[pascal(name)] || (lucide.icons && (lucide.icons[pascal(name)] || lucide.icons[name]));
  if (!icon) { missing.push(name); continue; }
  out[name] = geometry(icon);
}

console.log("    const ICONS = {");
const keys = Object.keys(out);
keys.forEach((k, i) => console.log("      %s: '%s'%s", JSON.stringify(k), out[k], i < keys.length - 1 ? "," : ""));
console.log("    };");

const bytes = keys.reduce((n, k) => n + out[k].length, 0);
process.stderr.write("\n" + keys.length + " icons, " + bytes + " bytes of geometry\n");
if (missing.length) {
  process.stderr.write("MISSING from lucide: " + missing.join(", ") +
    "\n  These render as empty buttons in the original. Find the real name" +
    " (e.g. waveform -> audio-waveform) and fix it in the port.\n");
}
if (inventoryPath) {
  const dest = path.join(path.dirname(inventoryPath), "icons.json");
  fs.writeFileSync(dest, JSON.stringify(out, null, 1));
  process.stderr.write("wrote " + dest + "\n");
}
