/*
 * Static check for the things that get a draft rejected at upload.
 *
 * Three of these are not in sdk.md at all — they were found by bisecting real
 * uploads (see cairn/README.md "What the upload validator rejects"). The error
 * messages the API returns do not name their actual cause, so catching them
 * here is much cheaper than catching them at upload.
 */
import { readFileSync } from "node:fs";

const PERMISSION_APIS = [
  { perm: "haptics",         re: /ctx\.platform\.haptic\s*\(/ },
  { perm: "backgroundMusic", re: /ctx\.music\.(?:play|start)\s*\(/ },
  { perm: "audio",           re: /ctx\.audio\.(?:play|loop)\s*\(/ },
  { perm: "storage",         re: /ctx\.storage\.(?:get|set|remove|clear)\s*\(/ },
  { perm: "camera",          re: /ctx\.camera\.start\s*\(/ },
  { perm: "microphone",      re: /ctx\.(?:microphone\.start|audio\.reactive\.start)\s*\(/ },
  { perm: "motion",          re: /ctx\.(?:sensors|motion)\.start\s*\(/ },
];

const BANNED = [
  { re: /document\s*\.\s*createElement/,        why: 'document.createElement — "Direct document/body access is not allowed." Declare markup on ctx.createRoot() and query it back with data-el attributes.' },
  { re: /document\s*\.\s*body/,                 why: "document.body — bits may not touch the host DOM." },
  { re: /document\s*\.\s*(?:head|documentElement)/, why: "document.head / documentElement — bits may not touch the host DOM." },
  { re: /\.getBoundingClientRect\s*\(/,         why: 'getBoundingClientRect() — rejected as "unsupported remote resources". Use event.offsetX / event.offsetY, which are already target-relative.' },
  { re: /\.\s*filter\s*=\s*["'`]\s*(?:blur|drop-shadow|url)/, why: "canvas ctx.filter = blur/url(...) — the property accepts url(#…) so writing it reads as pulling a remote resource. Build soft edges from concentric strokes." },
  { re: /new\s+Worker\s*\(/,                    why: "Workers are not permitted." },
  { re: /new\s+WebSocket\s*\(/,                 why: "Sockets are not permitted." },
  { re: /(?<!ctx\.)\bfetch\s*\(\s*["'`]https?:/, why: "http/https fetch — network egress is denied." },
  { re: /https?:\/\/(?!libs\.plethora\.studio)/, why: "remote URL that is not libs.plethora.studio." },
  { re: /<script/i,                             why: "script tag injection is not permitted." },
  { re: /\.innerHTML\s*=\s*[^;]*\bhttps?:\/\//, why: "remote URL inside injected markup." },
  { re: /localStorage|sessionStorage|indexedDB/, why: "raw browser storage — use ctx.storage (permission-gated)." },
  { re: /\bnew\s+Audio\s*\(/,                   why: "new Audio() is permission-guarded; prefer ctx.audio / ctx.music." },
  { re: /\b(?:webkitAudioContext|AudioContext)\s*\(/, why: "raw AudioContext is permission-guarded; prefer ctx.music / ctx.audio." },
  { re: /\bsetTimeout\s*\(/,                    why: "bare setTimeout — use ctx.timeout so the runtime owns cleanup.", soft: true },
  { re: /\bsetInterval\s*\(/,                   why: "bare setInterval — use ctx.interval so the runtime owns cleanup.", soft: true },
  { re: /\baddEventListener\s*\(/,              why: "bare addEventListener — use ctx.listen so the runtime owns cleanup.", soft: true },
];

const VALID_PERMS = ["audio","backgroundMusic","camera","haptics","microphone","motion","storage"];
const TAG_RE = /^[a-z0-9-]{1,32}$/;
const CHANNEL_RE = /^[a-z][a-z0-9_]{0,47}$/;
const MAX_PACKAGE = 2097152;

export function validateBit(dir) {
  const errors = [], warnings = [];
  const src = readFileSync(`${dir}/main.js`, "utf8");
  const manifest = JSON.parse(readFileSync(`${dir}/plethora.json`, "utf8"));

  // ---- banned constructs, reported with line numbers ----
  const lines = src.split("\n");
  for (const rule of BANNED) {
    lines.forEach((line, i) => {
      if (line.trimStart().startsWith("*") || line.trimStart().startsWith("//")) return;
      if (rule.re.test(line)) {
        (rule.soft ? warnings : errors).push(`main.js:${i + 1}  ${rule.why}\n      ${line.trim().slice(0, 110)}`);
      }
    });
  }

  // ---- manifest shape ----
  if (manifest.schemaVersion !== 1) errors.push('manifest: schemaVersion must be 1');
  if (manifest.runtime !== "plethora-bit@2") errors.push('manifest: runtime must be "plethora-bit@2"');
  if (manifest.entry !== "main.js") errors.push('manifest: entry must be "main.js"');
  for (const f of ["title", "description", "permissions", "dependencies"]) {
    if (manifest[f] === undefined) errors.push(`manifest: missing required field "${f}"`);
  }
  const allowed = new Set(["schemaVersion","runtime","entry","title","description","tags",
                           "permissions","dependencies","externalDependencies","memory"]);
  for (const k of Object.keys(manifest)) {
    if (!allowed.has(k)) errors.push(`manifest: unknown field "${k}" (additionalProperties: false)`);
  }
  if (manifest.tags) {
    if (manifest.tags.length > 12) errors.push(`manifest: ${manifest.tags.length} tags, max 12`);
    for (const t of manifest.tags) if (!TAG_RE.test(t)) errors.push(`manifest: tag "${t}" fails ${TAG_RE}`);
  }
  for (const p of manifest.permissions || []) {
    if (!VALID_PERMS.includes(p)) errors.push(`manifest: unknown permission "${p}"`);
  }

  // ---- permission <-> API agreement, both directions ----
  const declared = new Set(manifest.permissions || []);
  for (const { perm, re } of PERMISSION_APIS) {
    const used = re.test(src);
    if (used && !declared.has(perm)) errors.push(`manifest: source calls a ${perm} API but "${perm}" is not declared`);
    if (!used && declared.has(perm)) warnings.push(`manifest: declares "${perm}" but no matching API call was found`);
  }

  // ---- memory channels: declared vs used ----
  const mem = manifest.memory || {};
  let channelCount = 0;
  for (const fam of ["local","records","tallies","worlds"]) {
    for (const id of Object.keys(mem[fam] || {})) {
      channelCount++;
      if (!CHANNEL_RE.test(id)) errors.push(`memory: channel id "${id}" fails ${CHANNEL_RE}`);
      const label = mem[fam][id].label;
      if (label && label.length > 60) errors.push(`memory: label for "${id}" exceeds 60 chars`);
    }
  }
  if (channelCount > 16) errors.push(`memory: ${channelCount} channels, max 16`);

  const usedChannels = [
    ...[...src.matchAll(/ctx\.memory\.record\(\s*["']([a-z0-9_]+)["']/g)].map(m => ["records", m[1]]),
    ...[...src.matchAll(/ctx\.memory\.local\(\s*["']([a-z0-9_]+)["']/g)].map(m => ["local", m[1]]),
    ...[...src.matchAll(/ctx\.memory\.tally\(\s*["']([a-z0-9_]+)["']/g)].map(m => ["tallies", m[1]]),
    ...[...src.matchAll(/ctx\.memory\.world\(\s*["']([a-z0-9_]+)["']/g)].map(m => ["worlds", m[1]]),
  ];
  for (const [fam, id] of usedChannels) {
    if (!mem[fam] || !mem[fam][id]) errors.push(`memory: source uses ${fam} channel "${id}" which is not declared`);
  }

  // ---- record channel shape ----
  for (const [id, d] of Object.entries(mem.records || {})) {
    if (!["number","duration_ms","completion","percent","streak"].includes(d.valueType))
      errors.push(`memory.records.${id}: bad valueType "${d.valueType}"`);
    if (!["asc","desc"].includes(d.order)) errors.push(`memory.records.${id}: bad order "${d.order}"`);
    if (d.format && !["integer","decimal","timer","percent","compact"].includes(d.format))
      errors.push(`memory.records.${id}: bad format "${d.format}"`);
    for (const p of d.periods || []) if (!["daily","weekly","all_time"].includes(p))
      errors.push(`memory.records.${id}: bad period "${p}"`);
    for (const s of d.scopes || []) if (!["global","following"].includes(s))
      errors.push(`memory.records.${id}: bad scope "${s}"`);
    if (d.dedupe && !["best_per_user","latest_per_user","all_entries"].includes(d.dedupe))
      errors.push(`memory.records.${id}: bad dedupe "${d.dedupe}"`);
  }

  // ---- lifecycle ----
  if (!/window\.plethoraBit\s*=/.test(src)) errors.push("source: must assign window.plethoraBit");
  if (!/ctx\.platform\.ready\s*\(/.test(src)) errors.push("source: never calls ctx.platform.ready()");
  if (!/ctx\.platform\.start\s*\(/.test(src)) warnings.push("source: never calls ctx.platform.start() on first gesture");

  // ---- size ----
  const bytes = Buffer.byteLength(src, "utf8") + Buffer.byteLength(JSON.stringify(manifest), "utf8");
  if (bytes > MAX_PACKAGE) errors.push(`package ~${bytes} bytes exceeds the ${MAX_PACKAGE} limit`);

  return { errors, warnings, bytes };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let failed = 0;
  for (const dir of process.argv.slice(2)) {
    const { errors, warnings, bytes } = validateBit(dir);
    const name = dir.replace(/\/$/, "").split("/").pop();
    if (errors.length) {
      failed++;
      console.log(`\n✗ ${name}  (${bytes} bytes)`);
      for (const e of errors) console.log(`   ERROR  ${e}`);
    } else {
      console.log(`\n✓ ${name}  (${bytes} bytes)`);
    }
    for (const w of warnings) console.log(`   warn   ${w}`);
  }
  process.exit(failed ? 1 : 0);
}
