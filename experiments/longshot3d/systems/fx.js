import * as THREE from 'three';

/**
 * FX — tracers, impact dust, and the floating score numbers.
 *
 * Everything is pooled and preallocated. A `new THREE.Vector3()` inside a
 * per-frame path is a bug in this file, and a particle system that grows on
 * demand is how you get an unattributable hitch every forty seconds.
 */
const MAX_PUFFS = 220;

export class FxSystem {
  static id = 'fx';
  static deps = ['render'];

  async init(ctx) {
    this.ctx = ctx;
    this.owned = [];
    this.pops = [];

    // Tracers: a short streak behind each round in flight.
    const tg = new THREE.BufferGeometry();
    this.tracerBuf = new Float32Array(8 * 6);
    tg.setAttribute('position', new THREE.BufferAttribute(this.tracerBuf, 3));
    const tm = new THREE.LineBasicMaterial({ color: 0xffe6ae, transparent: true, opacity: 0.55, fog: false, depthWrite: false });
    this.owned.push(tg, tm);
    this.tracer = new THREE.LineSegments(tg, tm);
    this.tracer.frustumCulled = false;
    this.tracer.visible = false;
    ctx.scene.add(this.tracer);

    // Impact dust: one instanced quad pool, indices recycled oldest-first.
    const pg = new THREE.PlaneGeometry(1, 1);
    const pm = new THREE.MeshBasicMaterial({ color: 0xd8c49a, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
    this.owned.push(pg, pm);
    this.puffs = new THREE.InstancedMesh(pg, pm, MAX_PUFFS);
    this.puffs.frustumCulled = false;
    this.puffs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.puffs.count = MAX_PUFFS;
    ctx.scene.add(this.puffs);

    this.pool = new Array(MAX_PUFFS);
    for (let i = 0; i < MAX_PUFFS; i++) this.pool[i] = { t: 1e9, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 1, life: 1 };
    this.next = 0;
    this._m = new THREE.Matrix4();
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this.hideAll();
  }

  hideAll() {
    this._m.makeScale(0, 0, 0);
    for (let i = 0; i < MAX_PUFFS; i++) this.puffs.setMatrixAt(i, this._m);
    this.puffs.instanceMatrix.needsUpdate = true;
  }

  reset() {
    for (const p of this.pool) p.t = 1e9;
    this.pops.length = 0;
    this.hideAll();
    this.tracer.visible = false;
  }

  impact(x, y, z, kind) {
    const rng = this.ctx.rng;
    const n = kind === 'hit' ? 14 : 10;
    const spd = kind === 'hit' ? 5 : 3.2;
    for (let i = 0; i < n; i++) {
      const p = this.pool[this.next];
      this.next = (this.next + 1) % MAX_PUFFS;
      p.t = 0;
      p.life = kind === 'hit' ? 0.5 : 0.85;
      p.x = x; p.y = y; p.z = z;
      p.vx = (rng.float() - 0.5) * spd;
      p.vy = rng.float() * spd * 0.9 + 0.6;
      p.vz = (rng.float() - 0.5) * spd;
      p.s = (kind === 'hit' ? 0.14 : 0.22) * (0.6 + rng.float());
    }
    this.ctx.events.emit('bullet:impact', { x, y, z, surface: kind });
  }

  pop(x, y, z, points, zone, name, dist) {
    this.pops.push({ x, y, z, points, zone, name, dist, t: 0 });
    if (this.pops.length > 8) this.pops.shift();
  }

  setTracers(bullets) {
    let n = 0;
    for (const b of bullets) {
      if (!b.alive) continue;
      const sp = Math.hypot(b.vx, b.vy, b.vz) || 1;
      const back = 16;
      this.tracerBuf[n * 6] = b.x; this.tracerBuf[n * 6 + 1] = b.y; this.tracerBuf[n * 6 + 2] = b.z;
      this.tracerBuf[n * 6 + 3] = b.x - b.vx / sp * back;
      this.tracerBuf[n * 6 + 4] = b.y - b.vy / sp * back;
      this.tracerBuf[n * 6 + 5] = b.z - b.vz / sp * back;
      n++;
    }
    for (let i = n; i < 8; i++) for (let k = 0; k < 6; k++) this.tracerBuf[i * 6 + k] = 0;
    this.tracer.geometry.attributes.position.needsUpdate = true;
    this.tracer.visible = n > 0;
  }

  update(dt, ctx) {
    const cam = ctx.camera;
    let any = false;
    for (let i = 0; i < MAX_PUFFS; i++) {
      const p = this.pool[i];
      if (p.t > p.life) { continue; }
      p.t += dt;
      p.vy -= 6 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const k = 1 - p.t / p.life;
      if (k <= 0) {
        this._m.makeScale(0, 0, 0);
      } else {
        // Billboard, so a flat quad never shows its edge.
        this._q.copy(cam.quaternion);
        const s = p.s * (1.6 - k * 0.6);
        this._m.compose(this._v.set(p.x, p.y, p.z), this._q, this._s.set(s, s, s));
        any = true;
      }
      this.puffs.setMatrixAt(i, this._m);
    }
    this.puffs.instanceMatrix.needsUpdate = true;
    this.puffs.visible = any;
    for (let i = this.pops.length - 1; i >= 0; i--) {
      this.pops[i].t += dt;
      if (this.pops[i].t > 1.9) this.pops.splice(i, 1);
    }
  }

  async prewarmMaterials() { return { ok: true }; }
  dispose() { for (const o of this.owned) { try { o.dispose(); } catch (e) { /* gone */ } } }
}
