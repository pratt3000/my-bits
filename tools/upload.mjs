/*
 * Uploads bits to Plethora as DRAFTS.
 *
 * Publishing is deliberately not automated — the contract keeps it manual so
 * the creator reviews AI feedback and platform moderation before anything goes
 * public. This only ever calls /v1/agent/bits/drafts.
 *
 *   node tools/upload.mjs <token-file> [bit ...]
 *
 * With no bit names it uploads every folder holding a plethora.json. Each bit
 * is validated locally first: a draft rejected by the server costs a round
 * trip and the error messages do not name their actual cause.
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { validateBit } from "./harness/validate.mjs";

const REPO = "/home/user/my-bits";
const tokenFile = process.argv[2];
if (!tokenFile || !existsSync(tokenFile)) {
  console.error("usage: node tools/upload.mjs <token-file> [bit ...]");
  process.exit(1);
}
const token = readFileSync(tokenFile, "utf8").trim();

const named = process.argv.slice(3);
const bits = named.length ? named : readdirSync(REPO).filter(
  (d) => existsSync(`${REPO}/${d}/plethora.json`) && existsSync(`${REPO}/${d}/main.js`)).sort();

const results = [];
for (const bit of bits) {
  const dir = `${REPO}/${bit}`;
  const manifest = JSON.parse(readFileSync(`${dir}/plethora.json`, "utf8"));
  const source = readFileSync(`${dir}/main.js`, "utf8");

  const { errors } = validateBit(dir);
  if (errors.length) {
    console.log(`✗ ${bit}: local validation failed, not uploaded`);
    for (const e of errors.slice(0, 3)) console.log(`    ${e.split("\n")[0]}`);
    results.push({ bit, ok: false, why: "local validation" });
    continue;
  }

  // 504 deadline_exceeded is marked retryable by the API and happens often on
  // the larger bits, so back off and try again rather than reporting a failure
  // that is really just a slow server.
  let res, body, attempt = 0;
  while (attempt < 5) {
    attempt++;
    try {
      res = await fetch("https://api.plethora.studio/v1/agent/bits/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Plethora-Agent ${token}` },
        body: JSON.stringify({
          title: manifest.title,
          description: manifest.description,
          tags: manifest.tags,
          source,
          manifest,
          generated: true,
        }),
      });
      body = await res.json().catch(() => ({}));
    } catch (e) {
      body = null;
      if (attempt >= 5) {
        console.log(`✗ ${bit}: ${e.message}`);
        results.push({ bit, ok: false, why: e.message });
        break;
      }
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      continue;
    }
    if (res.status === 504 || body?.error?.retryable) {
      if (attempt < 5) {
        console.log(`  … ${bit}: ${res.status}, retrying (${attempt}/5)`);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
    }
    break;
  }
  if (!body) continue;

  if (res.ok && body.ok) {
    const d = body.data || {};
    console.log(`✓ ${bit}  ${d.action || "ok"}  ${d.packageBytes || "?"} bytes`);
    results.push({ bit, ok: true, action: d.action, id: d.bit && d.bit.id, bytes: d.packageBytes });
  } else {
    // 401 missing token · 403 bad/expired/wrong scope · 409 title already live
    // · 400 contract validation. The message is the useful part.
    const why = (body && (body.error || body.message)) || `HTTP ${res.status}`;
    console.log(`✗ ${bit}: HTTP ${res.status} — ${JSON.stringify(why, null, 1)}`);
    results.push({ bit, ok: false, status: res.status, why });
  }
}

const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} uploaded as drafts`);
writeFileSync("/tmp/claude-0/-home-user-my-bits/5b47fb00-0ae8-5201-8db8-9b2f8b1c2232/scratchpad/upload-results.json",
              JSON.stringify(results, null, 2));
if (ok < results.length) process.exit(1);
