/*
 * Photograph a bit at the states worth reviewing, on both the sizes it has to
 * survive: a phone, and the much shorter card the app runs it inside.
 *
 *   node tools/harness/shots-for.mjs <bit> [outDir]
 *
 * Writes <bit>-<device>-<state>.png for title, after the primary call to
 * action, and the settings and how-to-play panels. Canvas text is invisible
 * to check-contrast.mjs, so this is how it gets reviewed.
 */
import { openBit } from "./run.mjs";

const bit = process.argv[2];
const outDir = process.argv[3] || "tools/harness/shots";
if (!bit) { console.error("usage: node tools/harness/shots-for.mjs <bit> [outDir]"); process.exit(2); }

const DEVICES = [
  ["phone", { width: 390, height: 844 }, { top: 47, bottom: 34, left: 0, right: 0 }],
  ["card",  { width: 306, height: 517 }, { top: 0, bottom: 0, left: 0, right: 0 }],
];

for (const [tag, viewport, safeArea] of DEVICES) {
  const h = await openBit(bit, { outDir, dpr: 3, viewport, safeArea });
  const P = (fn, ...a) => h.probe(fn, ...a);
  const shot = (n) => h.shot(`${bit}-${tag}-${n}`);
  try {
    await h.wait(2400);
    console.log(await shot("1-title"));

    const cta = await P(() => {
      let best = null;
      for (const b of document.querySelectorAll("button")) {
        const r = b.getBoundingClientRect();
        const cs = getComputedStyle(b);
        if (cs.display === "none" || cs.pointerEvents === "none") continue;
        if (r.width < 90 || r.height < 24 || r.top < innerHeight * 0.45) continue;
        if (!best || r.width * r.height > best.a)
          best = { x: r.x + r.width / 2, y: r.y + r.height / 2, a: r.width * r.height };
      }
      return best;
    });
    if (cta) {
      await h.tap(cta.x, cta.y);
      await h.wait(2600);
      console.log(await shot("2-after"));
      await h.wait(2600);
      console.log(await shot("3-later"));
    }
    for (const name of ["cog", "help"]) {
      const p = await P((n) => {
        const el = document.querySelector(`[data-el="${n}"]`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
      }, name);
      if (!p) continue;
      await h.tap(p.x, p.y);
      await h.wait(1000);
      console.log(await shot("4-" + name));
      await P(() => {
        // Only a button a finger could actually reach. Several bits keep a
        // hidden "Got it" earlier in the DOM than the visible one, and
        // clicking that returned without dismissing anything — the panel
        // stayed open and swallowed the next tap, so the state after it was
        // never reached and never photographed.
        for (const b of document.querySelectorAll("button")) {
          if (!/done|got it|close|back/i.test(b.textContent)) continue;
          const r = b.getBoundingClientRect();
          const cs = getComputedStyle(b);
          if (!r.width || !r.height || cs.visibility === "hidden" || !b.offsetParent) continue;
          b.click();
          return;
        }
      });
      await h.wait(500);
    }
    const errs = (await h.errors()).filter((e) => !/404/.test(String(e)));
    if (errs.length) console.log("ERRORS: " + JSON.stringify(errs.slice(0, 3)));
  } finally { await h.close(); }
}
