/*
 * Text you cannot read, and text sitting on top of other text.
 *
 * Two objective checks over the DOM overlay, at whatever states a bit is
 * driven through:
 *
 *   contrast — every leaf text element's colour against the first opaque
 *              background behind it, as a WCAG ratio. Under 4.5:1 for body
 *              text and 3:1 for large text is a fail. Alpha in either colour
 *              is composited first, because `rgba(255,255,255,0.35)` on a
 *              dark panel is a real and common way to end up with grey mush.
 *
 *   overlap  — two text elements whose boxes intersect. Neither an ancestor
 *              of the other, both carrying their own text, more than a third
 *              of the smaller box covered.
 *
 * Canvas text is invisible to this. It has to be reviewed from screenshots.
 */
import { openBit } from "./run.mjs";

const PROBE = () => {
  const out = { contrast: [], overlap: [] };

  const parse = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c || "");
    if (!m) return null;
    const p = m[1].split(",").map((v) => parseFloat(v));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (fg, bg) => ({            // src-over composite
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  const shown = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity < 0.06) return false;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight;
  };

  /** Every colour that could be behind an element.
   *
   * Walks up for the first opaque background-color, and collects the stops of
   * the nearest gradient on the way — a button with `background: linear-
   * gradient(...)` reports a transparent backgroundColor, so without this the
   * walk sails past it to the near-black page behind and calls dark ink on a
   * bright button a 1.03 contrast failure. Both ends of a gradient are real
   * backgrounds for the text sitting on it, so both are returned and the
   * worst one decides.
   *
   * Anything half-transparent picked up on the way has to be carried down onto
   * whatever is finally found. A chip painted rgba(255,193,0,0.9) sitting on a
   * gradient panel used to be discarded the moment the gradient was reached,
   * so the checker measured the chip's dark ink against the panel's navy and
   * reported 1.05 for a chip that reads perfectly well on screen. False
   * findings that loud drown the true ones. */
  const behind = (el) => {
    const stops = [];
    let node = el, acc = null;
    while (node && node !== document.documentElement) {
      const cs = getComputedStyle(node);
      const bi = cs.backgroundImage;
      if (!stops.length && bi && bi !== "none") {
        for (const m of bi.matchAll(/rgba?\(([^)]+)\)/g)) {
          const c = parse(m[0]);
          if (c && c.a > 0.5) stops.push(c);
        }
        if (stops.length)
          return { colours: acc ? stops.map((b) => over(acc, b)) : stops,
                   gradient: true, stop: node };
      }
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0.02) {
        acc = acc ? over(acc, c) : c;
        if (acc.a > 0.98 || c.a > 0.98) return { colours: [acc], gradient: false, stop: node };
      }
      node = node.parentElement;
    }
    return { colours: acc ? [acc] : [], gradient: false, stop: null };
  };

  /** Ancestor `opacity` between the text and the background it sits on.
   *
   * getComputedStyle().color says nothing about it: an element inside a
   * container at opacity 0.45 reports its ink at full strength while the
   * player sees it at just under half. Opacity on the element that *owns* the
   * background is not counted — that composites text and background together
   * as one group, which leaves the ratio between them alone. */
  const dimming = (el, stop) => {
    let op = 1;
    for (let n = el; n && n !== stop; n = n.parentElement) {
      const v = parseFloat(getComputedStyle(n).opacity);
      if (!Number.isNaN(v)) op *= v;
    }
    return op;
  };

  /* Only text that is actually on top at its own centre.
   *
   * A settings panel is a full-screen overlay painted over the title screen,
   * and both are in the DOM at once — so every line of the panel "overlaps"
   * every line of the title underneath it. That is occlusion, not a bug, and
   * it drowned the real findings. elementFromPoint answers the only question
   * that matters: is this the thing a player would see there. */
  const texts = [];
  for (const el of document.querySelectorAll("div,span,button,p,li,h1,h2,h3,label")) {
    if (!shown(el)) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(
      Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)),
      Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)));
    if (!top || (top !== el && !el.contains(top) && !top.contains(el))) continue;
    texts.push(el);
  }

  for (const el of texts) {
    const cs = getComputedStyle(el);
    const fg = parse(cs.color);
    if (!fg) continue;
    // -webkit-text-fill-color:transparent is a gradient-filled heading; the
    // colour it reports has nothing to do with what is on screen.
    if (parse(cs.webkitTextFillColor || "")?.a === 0) continue;
    const bg = behind(el);
    if (!bg.colours.length) continue;
    const ink = { ...fg, a: fg.a * dimming(el, bg.stop) };
    let worst = Infinity, worstBg = null;
    for (const b of bg.colours) {
      if (b.a < 0.5) continue;
      const cr = ratio(ink.a < 1 ? over(ink, b) : ink, b);
      if (cr < worst) { worst = cr; worstBg = b; }
    }
    if (!worstBg) continue;
    const size = parseFloat(cs.fontSize);
    const bold = (parseInt(cs.fontWeight, 10) || 400) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    if (worst < need) {
      out.contrast.push({
        text: el.textContent.trim().slice(0, 30), ratio: +worst.toFixed(2), need,
        fg: cs.color, dimmed: +dimming(el, bg.stop).toFixed(2),
        bg: `rgb(${worstBg.r|0},${worstBg.g|0},${worstBg.b|0})`,
        size: cs.fontSize, gradient: bg.gradient,
      });
    }
  }

  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w <= 1 || h <= 1) continue;
      const share = (w * h) / Math.min(ra.width * ra.height, rb.width * rb.height);
      if (share > 0.34) {
        out.overlap.push({ a: a.textContent.trim().slice(0, 24), b: b.textContent.trim().slice(0, 24),
                           share: +share.toFixed(2) });
      }
    }
  }
  return out;
};

const DEV = { dpr: 3, viewport: { width: 390, height: 844 },
              safeArea: { top: 47, bottom: 34, left: 0, right: 0 } };

export async function scanBit(bit, { drive = true } = {}) {
  const h = await openBit(bit, DEV);
  const seen = new Map();
  const add = (where, r) => {
    for (const c of r.contrast) seen.set("c|" + where + "|" + c.text + c.ratio, { where, kind: "contrast", ...c });
    for (const o of r.overlap) seen.set("o|" + where + "|" + o.a + o.b, { where, kind: "overlap", ...o });
  };
  try {
    await h.wait(2400);
    add("title", await h.probe(PROBE));
    if (drive) {
      // The primary call to action, then whatever it opens.
      const cta = await h.probe(() => {
        let best = null;
        for (const b of document.querySelectorAll("button")) {
          const r = b.getBoundingClientRect();
          const cs = getComputedStyle(b);
          if (cs.display === "none" || cs.pointerEvents === "none") continue;
          if (r.width < 90 || r.height < 24 || r.top < innerHeight * 0.45) continue;
          if (!best || r.width * r.height > best.a) best = { x: r.x + r.width / 2, y: r.y + r.height / 2, a: r.width * r.height };
        }
        return best;
      });
      if (cta) { await h.tap(cta.x, cta.y); await h.wait(2400); add("after-cta", await h.probe(PROBE)); }
      // Settings and how-to-play, which are pure text panels and the most
      // likely place for a colour to have been picked without checking.
      for (const name of ["cog", "help"]) {
        const p = await h.probe((n) => {
          const el = document.querySelector(`[data-el="${n}"]`);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
        }, name);
        if (!p) continue;
        await h.tap(p.x, p.y); await h.wait(900);
        add(name, await h.probe(PROBE));
        await h.probe(() => {
          for (const b of document.querySelectorAll("button"))
            if (/done|got it|close|back/i.test(b.textContent)) { b.click(); return; }
        });
        await h.wait(500);
      }
    }
  } finally { await h.close(); }
  return [...seen.values()];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const bits = process.argv.slice(2);
  let total = 0;
  for (const bit of bits) {
    let rows = [];
    try { rows = await scanBit(bit); } catch (e) { console.log(`!  ${bit}: ${e.message}`); continue; }
    if (!rows.length) { console.log(`✓  ${bit}`); continue; }
    total += rows.length;
    console.log(`✗  ${bit}  (${rows.length})`);
    for (const r of rows.slice(0, 14)) console.log("     " + JSON.stringify(r));
  }
  console.log(total ? `\n${total} finding(s)` : "\nnothing flagged");
}
