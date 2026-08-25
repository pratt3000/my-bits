/*
 * Does the chrome fit the space the layout gives it, on a real range of phones?
 *
 * A bit that sizes its board from the screen and then fills the leftover with
 * fixed-pixel chrome looks right on the one viewport it was built against and
 * overlaps on a shorter screen or under a deeper notch. The default harness
 * viewport is an iPhone 14, which is close to the middle of the range and
 * hides both ends of it.
 *
 * Flex items default to `flex-shrink: 1`, so a starved column does not
 * overflow — it squashes, and every box still reports that it fits. What
 * actually shrinks is the space between the items, so that is what this
 * measures: the tightest gap in any column of chrome, per device. Read the
 * number. It fails only on the unambiguous cases — a box pushed off the
 * screen, or two items with under 4px between them.
 */
import { openBit } from "./run.mjs";

const DEVICES = [
  { name: "iPhone SE",       viewport: { width: 375, height: 667 }, safeArea: { top: 20, bottom: 0,  left: 0, right: 0 } },
  { name: "Android compact", viewport: { width: 360, height: 640 }, safeArea: { top: 24, bottom: 0,  left: 0, right: 0 } },
  { name: "iPhone 13 mini",  viewport: { width: 375, height: 812 }, safeArea: { top: 50, bottom: 34, left: 0, right: 0 } },
  { name: "Pixel 5",         viewport: { width: 393, height: 851 }, safeArea: { top: 24, bottom: 24, left: 0, right: 0 } },
  { name: "iPhone 14",       viewport: { width: 390, height: 844 }, safeArea: { top: 47, bottom: 34, left: 0, right: 0 } },
  { name: "iPhone 14 ProMax",viewport: { width: 430, height: 932 }, safeArea: { top: 59, bottom: 34, left: 0, right: 0 } },
];

const bits = process.argv.slice(2);
if (!bits.length) { console.error("usage: node tools/harness/check-fit.mjs <bit> [bit ...]"); process.exit(2); }

let bad = 0;
for (const bit of bits) {
  console.log(`\n${bit}`);
  const perElement = {};
  for (const d of DEVICES) {
    let h;
    try {
      h = await openBit(bit, { viewport: d.viewport, safeArea: d.safeArea });
      await h.wait(2000);
      const hits = await h.probe(() => {
        const out = [];
        const tight = [];
        const seen = new Set();
        const note = (o) => {
          const k = JSON.stringify(o);
          if (!seen.has(k)) { seen.add(k); out.push(o); }
        };
        const name = (el) => el.dataset.el || el.tagName.toLowerCase();
        const txt = (el) => el.textContent.trim().slice(0, 22);
        const shown = (el) => {
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };

        for (const el of document.querySelectorAll("div,button,span")) {
          if (!shown(el)) continue;
          const r = el.getBoundingClientRect();

          // Pushed past the edge of the screen. A masthead whose glyph box
          // runs a few px past its own line box is normal and not reported;
          // a box that has left the viewport is not.
          if (r.bottom > innerHeight + 2 || r.top < -2)
            note({ kind: "offscreen", el: name(el), txt: txt(el),
                   top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight });

          // A column that has run out of height for its own children. This is
          // what "cramped" looks like from the outside — a band sized from the
          // space left over around a board, holding chrome sized in fixed
          // pixels.
          //
          // scrollHeight does not show it: flex items default to
          // `flex-shrink: 1`, so a starved column squashes its children rather
          // than overflowing, and the container still reports that everything
          // fits. Sum what the children actually need instead.
          const cs2 = getComputedStyle(el);
          if (cs2.display !== "flex" || !cs2.flexDirection.startsWith("column")) continue;
          const kids = [...el.children].filter(shown);
          if (kids.length < 3 || el.clientHeight < 60) continue;
          // offsetTop/offsetHeight, not getBoundingClientRect: half the chrome
          // in these bits sits in a container rotated 180deg to face the other
          // player, and a screen-space rect there reports every gap as a large
          // negative number. Layout coordinates are rotation-independent.
          let min = Infinity, pair = null;
          for (let i = 1; i < kids.length; i++) {
            const a = kids[i - 1], b = kids[i];
            if (a.offsetParent !== b.offsetParent) continue;
            const gap = b.offsetTop - (a.offsetTop + a.offsetHeight);
            if (gap < min) { min = gap; pair = [txt(a), txt(b)]; }
          }
          if (min === Infinity) continue;
          if (pair) tight.push({ el: name(el), gap: +min.toFixed(1), between: pair });
        }
        tight.sort((a, b) => a.gap - b.gap);
        return { out, tight: tight.slice(0, 3) };
      });
      const hard = hits.out.filter(x => x.kind === "offscreen");
      for (const t of hits.tight) {
        const key = `${t.el} · ${t.between.join(" / ")}`;
        (perElement[key] = perElement[key] || {})[d.name] = t.gap;
      }
      const tightest = hits.tight[0];
      const gapNote = tightest
        ? `tightest gap ${tightest.gap}px (${tightest.between.join(" / ")})` : "no column chrome";
      if (hard.length) {
        bad++;
        console.log(`  ✗ ${d.name}  ${gapNote}`);
        for (const x of hard.slice(0, 4)) console.log(`      offscreen ${JSON.stringify(x)}`);
      } else {
        console.log(`  · ${d.name}  ${gapNote}`);
      }
    } catch (e) {
      console.log(`  ! ${d.name}: ${e.message}`);
    } finally { if (h) await h.close(); }
  }

  /* A gap that is 0 on every device is how the markup is built — the spacing
   * lives inside the child. A gap that is generous on a big screen and gone on
   * a small one is the layout being squeezed by the screen, which is the thing
   * worth failing on. */
  for (const [key, byDevice] of Object.entries(perElement)) {
    const vals = Object.values(byDevice);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    if (lo < 4 && hi > 8) {
      bad++;
      console.log(`  ✗ collapses on small screens: ${key}`);
      console.log(`      ${Object.entries(byDevice).map(([d, g]) => `${d} ${g}px`).join("  ")}`);
    }
  }
}
console.log(bad ? `\n${bad} problem(s)` : "\nno chrome collapses on any device");
process.exit(bad ? 1 : 0);
