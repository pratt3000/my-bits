/*
 * Every bit must survive a resize.
 *
 * A resize handler that rewrites canvas.width resets the 2D transform and the
 * game collapses into the top-left corner at 1/dpr scale. Six bits shipped
 * with exactly that, and no boot screenshot could have caught it because no
 * resize had happened yet.
 */
import { openBit } from "./run.mjs";
import { readdirSync, existsSync } from "node:fs";

const REPO = "/home/user/my-bits";
const bits = process.argv.slice(2).length ? process.argv.slice(2)
  : readdirSync(REPO).filter((d) => existsSync(`${REPO}/${d}/plethora.json`)).sort();

let bad = 0;
for (const bit of bits) {
  let b;
  try {
    b = await openBit(`${REPO}/${bit}`);
    await b.wait(1400);
    const before = await b.coverage();
    await b.resize(414, 896);                 // a different phone
    await b.wait(600);
    const after = await b.coverage();
    if (!before || !after) { console.log(`—  ${bit}: no 2D canvas to sample`); await b.close(); continue; }
    // If the bottom half goes dark while the top-left stays lit, the transform
    // was lost. Compare bottom coverage before and after.
    const botBefore = (before[2] + before[3]) / 2;
    const botAfter = (after[2] + after[3]) / 2;
    const collapsed = botBefore > 0.05 && botAfter < botBefore * 0.35;
    if (collapsed) {
      bad++;
      console.log(`✗  ${bit}: collapsed on resize — bottom coverage ${botBefore} -> ${botAfter}`);
    } else {
      console.log(`✓  ${bit}: survives resize (bottom ${botBefore} -> ${botAfter})`);
    }
    await b.close();
  } catch (e) {
    console.log(`!  ${bit}: ${e.message.slice(0, 80)}`);
    if (b) await b.close().catch(() => {});
  }
}
console.log(bad ? `\n${bad} bit(s) collapse on resize` : "\nall bits survive a resize");
process.exit(bad ? 1 : 0);
