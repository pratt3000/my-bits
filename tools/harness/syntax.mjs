/* Parse-check a bit's main.js without executing it. */
import { readFileSync } from "node:fs";
const src = readFileSync(process.argv[2], "utf8");
try { new (Object.getPrototypeOf(async function () {}).constructor)("ctx", src); }
catch (e) { console.error("SYNTAX ERROR:", e.message); process.exit(1); }
console.log("syntax OK —", src.split("\n").length, "lines,", Buffer.byteLength(src), "bytes");
