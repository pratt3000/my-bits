import * as THREE from 'three';

/**
 * TARGETS — the quarry, and the reason the scrub matters.
 *
 * Two kinds of animal share one AI, deliberately:
 *   cheetah  — the Thrixel sculpt. One merged mesh, so it is animated by
 *              heading, bob and lean; there are no leg nodes to swing.
 *   warthog, zebra — welded from boxes in code, with separate leg pairs that
 *              do swing. They exist so the two pipelines can be judged in the
 *              same frame, which is the whole point of this build.
 *
 * Detection is the mechanic: an animal notices you in proportion to how close
 * you are, how fast you are moving, and how badly the scrub is hiding you.
 */
const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export const SPECIES = {
  cheetah: { name: 'Cheetah', value: 800, tier: 'high', model: 'cheetah',
             len: 2.1, height: 1.15, speed: 3.4, sprint: 26, wary: 2.1, herd: [1, 1] },
  warthog: { name: 'Warthog', value: 25, tier: 'low', built: true,
             body: 0x6b5344, belly: 0x4c3a2f, mark: 0x2f2620,
             len: 1.3, size: 0.72, height: 0.92, legRatio: 0.4, bodyRatio: 0.78,
             speed: 3.2, sprint: 8, wary: 0.6, herd: [2, 4] },
  zebra:   { name: 'Zebra', value: 50, tier: 'low', built: true,
             body: 0xe8e4dc, belly: 0xf2efe8, mark: 0x231f1c,
             len: 2.2, size: 1.25, height: 1.4, speed: 4.2, sprint: 13, wary: 0.85, herd: [3, 6] }
};

/** Weld transformed boxes into one geometry with baked vertex colour. three's
 *  merge helper lives in addons we are not otherwise pulling in. */
function weld(parts, BOX) {
  let total = 0;
  const baked = [];
  for (const p of parts) {
    const g = BOX.clone().toNonIndexed();
    if (p.scale) g.scale(p.scale[0], p.scale[1], p.scale[2]);
    if (p.rot) { g.rotateX(p.rot[0]); g.rotateY(p.rot[1]); g.rotateZ(p.rot[2]); }
    if (p.pos) g.translate(p.pos[0], p.pos[1], p.pos[2]);
    baked.push({ g, color: p.color });
    total += g.attributes.position.count;
  }
  const position = new Float32Array(total * 3), normal = new Float32Array(total * 3), color = new Float32Array(total * 3);
  const c = new THREE.Color();
  let o = 0;
  for (const b of baked) {
    const gp = b.g.attributes.position, gn = b.g.attributes.normal;
    c.setHex(b.color);
    for (let i = 0; i < gp.count; i++) {
      position[(o + i) * 3] = gp.getX(i); position[(o + i) * 3 + 1] = gp.getY(i); position[(o + i) * 3 + 2] = gp.getZ(i);
      normal[(o + i) * 3] = gn.getX(i); normal[(o + i) * 3 + 1] = gn.getY(i); normal[(o + i) * 3 + 2] = gn.getZ(i);
      color[(o + i) * 3] = c.r; color[(o + i) * 3 + 1] = c.g; color[(o + i) * 3 + 2] = c.b;
    }
    o += gp.count;
    b.g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
  return geo;
}

export class TargetSystem {
  static id = 'targets';
  static deps = ['world', 'assets'];

  async init(ctx) {
    this.ctx = ctx;
    this.world = ctx.get('world');
    this.assets = ctx.get('assets');
    this.rand = (() => { const r = ctx.rng.fork('targets'); return () => r.float(); })();
    this.owned = [];
    this.group = new THREE.Group();
    ctx.scene.add(this.group);
    this.rigs = {};
    this.list = [];
    this.spook = 0;
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
    this._up = new THREE.Vector3(0, 1, 0);

    const BOX = new THREE.BoxGeometry(1, 1, 1);
    this._BOX = BOX;
    for (const key of Object.keys(SPECIES)) this.buildRig(key, BOX);

    // Ground decals, one per animal, moved every frame.
    const g = new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2);
    const m = new THREE.MeshBasicMaterial({ color: 0x1a1408, transparent: true, opacity: 0.36, depthWrite: false });
    this.owned.push(g, m);
    this.shade = new THREE.InstancedMesh(g, m, 48);
    this.shade.frustumCulled = false;
    this.shade.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shade.count = 0;
    this.group.add(this.shade);

    const cap = ctx.config.q.maxTargets ?? 24;
    for (const key of Object.keys(SPECIES)) {
      const n = key === 'cheetah' ? Math.max(3, Math.round(cap * 0.22)) : Math.round(cap * 0.42);
      for (let i = 0; i < n; i++) this.list.push(this.makeOne(key));
    }
    for (let i = 0; i < 6; i++) this.spawnHerd();
  }

  buildRig(key, BOX) {
    const s = SPECIES[key];
    if (!s.built) { this.rigs[key] = { model: s.model, standY: 0 }; return; }
    const L = s.len, W = s.size, H = s.height;
    const BR = s.bodyRatio ?? 0.52;
    const body = [
      { scale: [W * 0.78, H * BR, L], pos: [0, 0, 0], color: s.body },
      { scale: [W * 0.72, H * 0.3, L * 0.44], pos: [0, -H * 0.16, L * 0.06], color: s.belly },
      { scale: [W * 0.66, H * 0.42, L * 0.34], pos: [0, H * 0.06, L * 0.42], color: s.body },
      { scale: [W * 0.13, W * 0.13, L * 0.3], pos: [0, H * 0.1, -L * 0.6], rot: [-0.5, 0, 0], color: s.mark }
    ];
    if (key === 'zebra') {
      for (let i = 0; i < 5; i++) {
        body.push({ scale: [W * 0.8, H * 0.53, L * 0.075], pos: [0, 0, -L * 0.34 + i * L * 0.17], color: s.mark });
      }
    }
    const neckUp = key === 'zebra' ? 0.55 : 0.2;
    const head = [
      { scale: [W * 0.3, W * 0.3, L * 0.42], pos: [0, H * neckUp * 0.5, L * 0.18], rot: [-neckUp, 0, 0], color: s.body },
      { scale: [W * 0.34, W * 0.34, L * 0.3], pos: [0, H * neckUp * 0.86, L * 0.42], color: s.body },
      { scale: [W * 0.22, W * 0.2, L * 0.2], pos: [0, H * neckUp * 0.8, L * 0.58], color: s.mark },
      { scale: [W * 0.1, W * 0.14, W * 0.08], pos: [W * 0.14, H * neckUp * 1.1, L * 0.4], color: s.mark },
      { scale: [W * 0.1, W * 0.14, W * 0.08], pos: [-W * 0.14, H * neckUp * 1.1, L * 0.4], color: s.mark }
    ];
    const legLen = H * (s.legRatio ?? 0.62), legW = W * 0.15;
    const legPair = (front) => {
      const out = [];
      const zz = front ? L * 0.32 : -L * 0.3;
      for (const x of [W * 0.28, -W * 0.28]) {
        out.push({ scale: [legW, legLen, legW], pos: [x, -legLen * 0.5, zz], color: s.body });
        out.push({ scale: [legW * 1.2, legW * 0.9, legW * 1.6], pos: [x, -legLen, zz + legW * 0.2], color: s.mark });
      }
      return weld(out, BOX);
    };
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const rig = {
      bodyGeo: weld(body, BOX), headGeo: weld(head, BOX),
      legF: legPair(true), legB: legPair(false), mat,
      standY: legLen + H * BR * 0.5
    };
    this.owned.push(rig.bodyGeo, rig.headGeo, rig.legF, rig.legB, mat);
    this.rigs[key] = rig;
  }

  makeOne(key) {
    const spec = SPECIES[key];
    const rig = this.rigs[key];
    const g = new THREE.Group();
    let body = null, head = null, legF = null, legB = null, standY = 0;
    if (spec.built) {
      body = new THREE.Mesh(rig.bodyGeo, rig.mat);
      head = new THREE.Mesh(rig.headGeo, rig.mat);
      legF = new THREE.Mesh(rig.legF, rig.mat);
      legB = new THREE.Mesh(rig.legB, rig.mat);
      for (const m of [body, head, legF, legB]) { m.castShadow = true; g.add(m); }
      standY = rig.standY;
    } else {
      const inst = this.assets.instance(spec.model);
      if (inst) g.add(inst);
      standY = 0;
    }
    g.visible = false;
    this.group.add(g);
    return {
      key, spec, group: g, body, head, legF, legB, standY,
      alive: false, x: 0, y: 0, z: 0, heading: 0, speed: 0,
      state: 'graze', alert: 0, gait: 0, want: 0, rest: 0, flee: 0, look: 0
    };
  }

  freeSlot(key) {
    for (const t of this.list) if (!t.alive && t.key === key) return t;
    return null;
  }

  pickSpecies() {
    // High value is rare on purpose: a cheetah is worth sixteen warthogs.
    const w = { warthog: 30, zebra: 24, cheetah: 4 };
    let total = 0;
    for (const k in w) total += w[k];
    let r = this.rand() * total;
    for (const k in w) { r -= w[k]; if (r <= 0) return k; }
    return 'warthog';
  }

  spawnHerd() {
    const key = this.pickSpecies();
    const spec = SPECIES[key];
    const px = this.player?.x ?? 0, pz = this.player?.z ?? 0;
    let anchor = null;
    for (let i = 0; i < 24 && !anchor; i++) {
      const a = this.rand() * TAU, r = 70 + this.rand() * 240;
      const x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r;
      if (Math.hypot(x, z) > 330) continue;
      if (this.world.slopeAt(x, z) > 0.45) continue;
      anchor = { x, z };
    }
    if (!anchor) return 0;
    const n = spec.herd[0] + Math.floor(this.rand() * (spec.herd[1] - spec.herd[0] + 1));
    let placed = 0;
    for (let i = 0; i < n; i++) {
      const t = this.freeSlot(key);
      if (!t) break;
      const a = this.rand() * TAU, spread = 2 + i * 2.4;
      t.x = anchor.x + Math.cos(a) * spread * this.rand();
      t.z = anchor.z + Math.sin(a) * spread * this.rand();
      t.y = this.world.heightAt(t.x, t.z);
      t.alive = true; t.heading = this.rand() * TAU; t.want = t.heading;
      t.speed = 0; t.state = 'graze'; t.alert = 0; t.gait = this.rand() * TAU;
      t.rest = 1 + this.rand() * 4; t.flee = 0; t.look = 0;
      t.group.visible = true;
      placed++;
    }
    return placed;
  }

  kill(t) { t.alive = false; t.group.visible = false; }

  update(dt, ctx) {
    const weapons = ctx.peek('weapons');
    this.player = weapons?.player;
    if (!this.player) return;
    const p = this.player;
    const conceal = this.world.concealmentAt(p.x, p.z);
    const moving = clamp(p.moveMag ?? 0, 0, 1);
    let sN = 0;

    for (const t of this.list) {
      if (!t.alive) continue;
      const spec = t.spec;
      const dx = p.x - t.x, dz = p.z - t.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 430 || Math.hypot(t.x, t.z) > 400) { this.kill(t); continue; }

      /* --- does it notice you? ---------------------------------------- */
      const range = 115 * spec.wary;
      let detect = 0;
      if (dist < range) {
        const near = 1 - dist / range;
        // Concealment is your half of this and movement is the other half.
        // Standing still in a thicket at 200 m is effectively invisible.
        detect = near * near * spec.wary * (1 - conceal * 0.92) * (0.26 + moving * 1.5);
        if (this.world.blocked(p.x, p.y + 1.6, p.z, t.x, t.y + 0.8, t.z)) detect *= 0.16;
      }
      t.alert = clamp(t.alert + (detect * 1.35 - 0.42) * dt + this.spook * spec.wary * dt * 2.2, 0, 1.6);

      if (t.alert >= 1 && t.state !== 'flee') {
        t.state = 'flee';
        t.flee = 4 + this.rand() * 5;
        t.want = Math.atan2(t.x - p.x, t.z - p.z) + (this.rand() - 0.5) * 0.8;
      } else if (t.alert > 0.4 && t.state !== 'flee') t.state = 'alert';
      else if (t.state === 'alert' && t.alert <= 0.4) t.state = 'graze';

      let want = 0;
      if (t.state === 'flee') {
        t.flee -= dt;
        want = spec.sprint;
        if (t.flee <= 0) { t.state = 'graze'; t.alert = 0.5; t.rest = 2 + this.rand() * 3; }
      } else if (t.state === 'alert') {
        want = 0;
      } else {
        t.rest -= dt;
        if (t.rest <= 0) {
          t.rest = 2.5 + this.rand() * 6;
          if (t.state === 'graze') { t.state = 'walk'; t.want = t.heading + (this.rand() - 0.5) * 2.6; }
          else t.state = 'graze';
        }
        want = t.state === 'walk' ? spec.speed * 0.4 : 0;
      }

      let dh = t.want - t.heading;
      while (dh > Math.PI) dh -= TAU;
      while (dh < -Math.PI) dh += TAU;
      const turn = t.state === 'flee' ? 2.6 : 1.4;
      t.heading += clamp(dh, -turn * dt, turn * dt);
      t.speed += clamp(want - t.speed, -14 * dt, 9 * dt);

      if (t.speed > 0.01) {
        const nx = t.x + Math.sin(t.heading) * t.speed * dt;
        const nz = t.z + Math.cos(t.heading) * t.speed * dt;
        if (this.world.slopeAt(nx, nz) > 0.62) t.want = t.heading + 1.6;
        else { t.x = nx; t.z = nz; }
      }
      t.y = this.world.heightAt(t.x, t.z);

      /* --- pose --------------------------------------------------------- */
      const g = t.group;
      const runv = t.speed / Math.max(1, spec.sprint);
      t.gait += dt * (2.6 + runv * 16);
      g.position.set(t.x, t.y + t.standY + Math.abs(Math.sin(t.gait)) * runv * 0.16, t.z);
      g.rotation.y = t.heading;
      if (t.legF) {
        const swing = Math.sin(t.gait) * (0.25 + runv * 0.7);
        t.legF.rotation.x = swing;
        t.legB.rotation.x = -swing;
        t.body.rotation.x = -runv * 0.12;
        const wantHead = t.state === 'graze' ? -0.75 : t.state === 'alert' ? 0.16 : -0.15;
        t.look += (wantHead - t.look) * clamp(dt * 5, 0, 1);
        t.head.rotation.x = t.look;
      } else {
        // One merged mesh: no legs to swing, so the gallop is sold by lean
        // and bob alone. At sniping range it reads; at two metres it would not.
        g.rotation.x = -runv * 0.1;
        g.rotation.z = Math.sin(t.gait * 0.5) * runv * 0.06;
      }

      if (sN < this.shade.instanceMatrix.count) {
        this.world.normalAt(t.x, t.z, this._v);
        this._q.setFromUnitVectors(this._up, this._v);
        this._m.compose(new THREE.Vector3(t.x, t.y + 0.06, t.z), this._q,
          new THREE.Vector3(spec.len * 0.45, 1, spec.len * 0.45));
        this.shade.setMatrixAt(sN++, this._m);
      }
    }

    this.shade.count = sN;
    this.shade.instanceMatrix.needsUpdate = true;
    this.spook = Math.max(0, this.spook - dt * 1.6);

    let alive = 0;
    for (const t of this.list) if (t.alive) alive++;
    this._spawnT = (this._spawnT ?? 0) - dt;
    if (alive < (ctx.config.q.maxTargets ?? 24) && this._spawnT <= 0) {
      this._spawnT = 1.2;
      this.spawnHerd();
    }
  }

  /** Debug hook the shot list drives, so a framing can stage exactly what it
   *  is meant to show instead of hoping the wander AI cooperates. */
  debugPlace(key, x, z, heading = 0, state = 'graze') {
    const t = this.freeSlot(key);
    if (!t) return null;
    t.alive = true;
    t.x = x; t.z = z; t.y = this.world.heightAt(x, z);
    t.heading = heading; t.want = heading; t.speed = 0;
    t.state = state; t.alert = state === 'alert' ? 0.7 : 0;
    t.gait = 0; t.rest = 99; t.flee = 0; t.look = state === 'graze' ? -0.75 : 0.16;
    t.group.visible = true;
    return t;
  }

  debugClear() { for (const t of this.list) this.kill(t); }

  dispose() { for (const o of this.owned) { try { o.dispose(); } catch (e) { /* gone */ } } }
}
