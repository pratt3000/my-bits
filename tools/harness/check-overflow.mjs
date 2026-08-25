/*
 * Text that is wider than the box it was given.
 *
 * Swapping every display face for Inter changed the widths of a lot of
 * already-tuned headings — Inter is far wider than a condensed face like
 * Bebas Neue at the same size — and a heading painted with
 * -webkit-background-clip:text does not overflow visibly, it just loses the
 * glyphs that fall outside its own box. That reads as a truncated title
 * rather than as a layout bug, so it is worth a check of its own.
 *
 * Compares each leaf element's Range width against its content box, at boot
 * and again after the panels a bit opens from its title screen.
 */
import { openBit } from "./run.mjs";
import { readdirSync, existsSync } from "node:fs";

const BITS = process.argv.slice(2).filter(a => !a.startsWith("-"));
const dirs = BITS.length ? BITS
  : readdirSync(".", { withFileTypes: true })
      .filter(d => d.isDirectory() && existsSync(`${d.name}/plethora.json`))
      .map(d => d.name).sort();

const SLACK = 2;                     // px; sub-pixel rounding is not a bug

let bad = 0;
for (const bit of dirs) {
  let h;
  try {
    h = await openBit(bit);
    await h.wait(2200);
    const hits = await h.probe((slack) => {
      const out = [];
      for (const el of document.querySelectorAll("div,span,button,p,li,h1,h2,h3")) {
        if (el.children.length || !el.textContent.trim()) continue;
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) continue;
        const box = el.clientWidth;
        if (!box) continue;
        const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
        const r = document.createRange();
        r.selectNodeContents(el);
        const want = r.getBoundingClientRect().width;
        if (want > box - pad + slack) {
          out.push({ text: el.textContent.trim().slice(0, 34), want: +want.toFixed(1),
                     box: +(box - pad).toFixed(1), size: cs.fontSize });
        }
      }
      return out;
    }, SLACK);
    if (hits.length) {
      bad++;
      console.log(`✗  ${bit}`);
      for (const x of hits) console.log(`     "${x.text}" wants ${x.want}px in ${x.box}px @ ${x.size}`);
    } else {
      console.log(`✓  ${bit}`);
    }
  } catch (e) {
    console.log(`!  ${bit}: ${e.message}`);
  } finally { if (h) await h.close(); }
}
console.log(bad ? `\n${bad} bit(s) with overflowing text` : "\nno overflowing text");
process.exit(bad ? 1 : 0);
