/**
 * Longshot — entry point.
 *
 * Order matters and each step is load-bearing; see the kit's threejs.md.
 */
import { Engine, boot, Input, configFromLocation, installShotApi, signalReady, prewarm } from './lib/index.js';

import { RenderSystem } from './systems/render.js';
import { WorldSystem } from './systems/world.js';
import { AssetSystem } from './systems/assets.js';
import { TargetSystem } from './systems/targets.js';
import { WeaponSystem } from './systems/weapons.js';
import { FxSystem } from './systems/fx.js';
import { UiSystem } from './systems/ui.js';
import { SHOTS, clearState } from './shots.js';

const { config, capture, lockstep, shot } = configFromLocation();
// configFromLocation returns capture alongside config, not on it. Systems need
// to know, so publish it once here rather than each of them guessing.
config.capture = capture;

// Scatter budgets live alongside the kit's quality preset so one knob moves
// pixels, shadow resolution and vegetation density together.
const SCATTER = {
  low:    { terrainSeg: 130, grass: 1500, bush: 320, tree: 160, rock: 180, maxTargets: 16 },
  medium: { terrainSeg: 168, grass: 2600, bush: 460, tree: 230, rock: 250, maxTargets: 22 },
  high:   { terrainSeg: 200, grass: 3800, bush: 580, tree: 300, rock: 320, maxTargets: 28 },
  ultra:  { terrainSeg: 240, grass: 5200, bush: 720, tree: 380, rock: 400, maxTargets: 32 }
};
Object.assign(config.q, SCATTER[config.quality] ?? SCATTER.high);

const canvas = document.getElementById('game');
const input = new Input(canvas, { sensitivity: config.sensitivity });
const engine = new Engine({ canvas, config, input });

engine.add(RenderSystem).add(WorldSystem).add(AssetSystem)
      .add(TargetSystem).add(WeaponSystem).add(FxSystem).add(UiSystem);

// Boot with a VISIBLE failure: a black canvas with the error only in devtools
// costs a whole capture cycle to diagnose.
try {
  await boot(engine);
} catch (err) {
  const el = document.getElementById('boot');
  if (el) el.textContent = 'boot failed\n\n' + (err && err.stack || err);
  throw err;
}

const shotApi = installShotApi(engine, { shots: SHOTS, capture, lockstep, clearState });

window.__PREWARM__ = config.prewarm
  ? await prewarm(engine)
  : { ok: false, reason: 'disabled by ?prewarm=0' };

engine.start();

if (shot) window.__APPLY_SHOT__(shot);
// Ready after a fixed FRAME COUNT, not a timeout, so boot duration cannot
// change what a capture sees.
await signalReady(shotApi, 3);
document.getElementById('boot')?.remove();

if (import.meta.hot) import.meta.hot.dispose(() => engine.dispose());
