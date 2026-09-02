/**
 * THE SHOT LIST — written before the art, so iteration N is comparable to
 * iteration N+1. Each shot owns one axis this game will be judged on, and the
 * `doc` line says what it is FOR so a review round critiques the right thing.
 *
 * Heights here are metres ABOVE THE GROUND, not world Y. The terrain has real
 * elevation, so an absolute Y frames a different thing at every spot on the
 * map — the first version of this file did exactly that and every staged
 * animal was below the bottom of frame.
 */

/** Place the camera in ground-relative coordinates. Runs inside apply(), which
 *  the shot API calls after it has set the raw pos/look. */
function aim(engine, [cx, cUp, cz], [lx, lUp, lz], fov) {
  const w = engine.registry.peek('world');
  const cam = engine.ctx.camera;
  cam.position.set(cx, w.heightAt(cx, cz) + cUp, cz);
  cam.lookAt(lx, w.heightAt(lx, lz) + lUp, lz);
  if (fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
  cam.updateMatrixWorld(true);
}

/** Find open, level ground near the middle of the map. Staging a shot at the
 *  origin put the camera under an acacia twice, which reads as a black slab
 *  across the top of the frame and wastes a review round. */
function clearing(engine, minRadius = 9) {
  const w = engine.registry.peek('world');
  let best = null;
  for (let i = 0; i < 900; i++) {
    const a = (i / 900) * Math.PI * 2 * 11, r = 20 + (i / 900) * 220;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (w.slopeAt(x, z) > 0.16) continue;
    let near = 1e9;
    for (const c of w.covers) {
      const d = Math.hypot(x - c.x, z - c.z) - c.r;
      if (d < near) near = d;
    }
    if (near < minRadius) continue;
    if (!best || near > best.near) best = { x, z, near };
    if (best.near > minRadius * 2) break;
  }
  return best ?? { x: 0, z: 0 };
}

const T = (engine) => engine.registry.peek('targets');
const W = (engine) => engine.registry.peek('weapons');

export const SHOTS = {
  establishing: {
    pos: [0, 20, 60], look: [0, 6, -40], fov: 62,
    doc: 'Wide over the savanna — art direction, silhouette, depth cueing through haze.',
    apply(e) { T(e)?.debugClear(); W(e)?.debugState({ viewmodel: false }); aim(e, [40, 9, 70], [-20, 2, -60], 62); }
  },
  hero_target: {
    pos: [0, 2, 8], look: [0, 1, 0], fov: 38,
    doc: 'The Thrixel cheetah at 8 m — the asset this evaluation is about. Anatomy, coat, texel density.',
    apply(e) {
      const c = clearing(e, 11);
      T(e)?.debugClear();
      W(e)?.debugState({ viewmodel: false });
      T(e)?.debugPlace('cheetah', c.x, c.z, 2.4, 'alert');
      aim(e, [c.x + 3.3, 1.15, c.z + 3.3], [c.x, 0.62, c.z], 40);
    }
  },
  weapon: {
    pos: [0, 2, 0], look: [0, 2, -6], fov: 55,
    doc: 'The rifle viewmodel — the object on screen every frame, and the usual failure point in an FPS.',
    apply(e) {
      const c = clearing(e, 12);
      T(e)?.debugClear();
      W(e)?.debugState({ scoped: false, viewmodel: true });
      aim(e, [c.x, 1.62, c.z], [c.x, 1.2, c.z - 12], 55);
    }
  },
  scoped: {
    pos: [0, 2, 0], look: [0, 2, -200], fov: 10,
    doc: 'Down the scope at 200 m — reticle legibility, whether a target reads at range, haze falloff.',
    apply(e) {
      const w = e.registry.peek('world');
      // From the high ground, or the next rise is the whole sight picture.
      let hi = null;
      for (let i = 0; i < 500; i++) {
        const a = (i / 500) * Math.PI * 2 * 9, r = 40 + (i / 500) * 240;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const h = w.heightAt(x, z);
        if (!hi || h > hi.h) hi = { x, z, h };
      }
      // Put the quarry on ground the sight line actually reaches.
      const dx = -hi.x, dz = -hi.z;
      const L = Math.hypot(dx, dz) || 1;
      const tx = hi.x + (dx / L) * 190, tz = hi.z + (dz / L) * 190;
      T(e)?.debugClear();
      T(e)?.debugPlace('cheetah', tx, tz, 1.3, 'alert');
      T(e)?.debugPlace('zebra', tx - 9, tz - 6, 1.6, 'graze');
      W(e)?.debugState({ scoped: true, viewmodel: false });
      aim(e, [hi.x, 1.62, hi.z], [tx, w.heightAt(tx, tz) - w.heightAt(hi.x, hi.z) + 0.8, tz], 10);
    }
  },
  cover: {
    pos: [0, 1.2, 0], look: [0, 1, -14], fov: 58,
    doc: 'Down in the scrub — the concealment mechanic made visible; foliage density and ground contact.',
    apply(e) {
      const t = T(e); t?.debugClear(); W(e)?.debugState({ viewmodel: false });
      const w = e.registry.peek('world');
      // Frame an actual bush, not wherever the origin happens to be.
      const c = w.covers.find((o) => o.r > 2.4 && Math.hypot(o.x, o.z) < 200) || w.covers[0];
      t?.debugPlace('cheetah', c.x + 20, c.z - 28, 2.0, 'graze');
      // Crouched at the EDGE of the scrub looking out of it, not buried inside
      // it — inside, the whole frame is one leaf.
      const ang = Math.atan2(-28, 20);
      aim(e, [c.x - Math.cos(ang) * (c.r + 1.6), 0.95, c.z - Math.sin(ang) * (c.r + 1.6)],
             [c.x + 20, 0.75, c.z - 28], 58);
    }
  },
  contrast: {
    pos: [0, 2, 8], look: [0, 1, 0], fov: 46,
    doc: 'Thrixel cheetah beside two code-built animals — the side-by-side this build exists to show.',
    apply(e) {
      const c = clearing(e, 13);
      T(e)?.debugClear();
      W(e)?.debugState({ viewmodel: false });
      T(e)?.debugPlace('cheetah', c.x + 2.2, c.z, 2.5, 'alert');
      T(e)?.debugPlace('zebra', c.x - 2.6, c.z - 0.6, 2.4, 'alert');
      T(e)?.debugPlace('warthog', c.x - 0.2, c.z - 3.6, 2.1, 'graze');
      aim(e, [c.x + 6.5, 1.75, c.z + 8.5], [c.x - 0.4, 0.5, c.z - 1.2], 40);
    }
  },
  sun: {
    pos: [0, 3, 20], look: [40, 12, -60], fov: 62,
    doc: 'Into the low sun — exposure at the extreme, sky gradient, whether the fog reads as air.',
    apply(e) {
      T(e)?.debugClear();
      W(e)?.debugState({ viewmodel: false });
      const r = e.registry.peek('render');
      const d = r._sunDir;
      aim(e, [0, 3, 0], [d.x * 300, 60, d.z * 300], 62);
    }
  },
  ridge: {
    pos: [0, 26, -110], look: [0, 4, 60], fov: 70,
    doc: 'From the high ground — draw distance, terrain silhouette, scatter falloff, the far range.',
    apply(e) {
      T(e)?.debugClear();
      W(e)?.debugState({ viewmodel: false });
      const w = e.registry.peek('world');
      // Stand on the highest reachable ground, which is also where the game
      // drops the player at boot.
      let best = null;
      for (let i = 0; i < 400; i++) {
        const a = (i / 400) * Math.PI * 2 * 9, r = 40 + (i / 400) * 260;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const h = w.heightAt(x, z);
        if (!best || h > best.h) best = { x, z, h };
      }
      aim(e, [best.x, 2.4, best.z], [0, -6, 0], 70);
    }
  }
};

/** Transient state that must not survive into the next shot. */
export function clearState(engine) {
  engine.registry?.peek?.('fx')?.reset?.();
}
