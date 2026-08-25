/*
 * Does the bit fill the screen on a 3x phone?
 *
 * The runtime sizes the canvas buffer at the device's real pixel ratio and
 * installs a matching transform. A bit that caps the ratio for its own texture
 * bakes — sensible, 2x is already past what the eye resolves — and then reuses
 * that capped number for `setTransform` or for `canvas.width` draws every frame
 * at two-thirds scale into the top-left corner and leaves the rest of the
 * screen empty.
 *
 * It is invisible at 2x, which is what most desktop-sized harness runs use,
 * and it is what most phones actually are: iPhone 12 and up, and most flagship
 * Android, are 3x.
 *
 * Reports the four quadrant coverage ratios. A bit that paints the top-left
 * and little else is the signature.
 */
import { openBit } from "./run.mjs";
import { readdirSync, existsSync } from "node:fs";

const named = process.argv.slice(2).filter(a => !a.startsWith("-"));
const dirs = named.length ? named
  : readdirSync(".", { withFileTypes: true })
      .filter(d => d.isDirectory() && existsSync(`${d.name}/plethora.json`))
      .map(d => d.name).sort();

let bad = 0;
for (const bit of dirs) {
  let h;
  try {
    h = await openBit(bit, { dpr: 3, viewport: { width: 390, height: 844 } });
    await h.wait(2400);
    const q = await h.coverage();
    if (!q) { console.log(`—  ${bit}: no 2D canvas to sample`); continue; }
    const [tl, tr, bl, br] = q;
    // The top-left is always the corner that survives, so compare the other
    // three against it rather than against an absolute floor: a bit that is
    // legitimately dark in one corner still scales its three corners together.
    const rest = Math.max(tr, bl, br);
    if (tl > 0.5 && rest < tl * 0.6) {
      bad++;
      console.log(`✗  ${bit}: drawn into the top-left — quads ${JSON.stringify(q)}`);
    } else {
      console.log(`✓  ${bit}: fills the screen at 3x — quads ${JSON.stringify(q)}`);
    }
  } catch (e) {
    console.log(`!  ${bit}: ${e.message}`);
  } finally { if (h) await h.close(); }
}
console.log(bad ? `\n${bad} bit(s) do not fill a 3x screen` : "\nevery bit fills a 3x screen");
process.exit(bad ? 1 : 0);
