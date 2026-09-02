import * as THREE from 'three';

/**
 * WEAPONS — the player, the rifles, and a bullet that actually flies.
 *
 * A round leaves the muzzle at 810 m/s and is then on its own: it is stepped
 * under gravity and tested against the world every 3.5 ms. At 500 m that is
 * six tenths of a second of flight and about two metres of drop, so you hold
 * over and you lead. That is the entire reason a sprinting cheetah is worth
 * eight hundred points and a grazing warthog is worth twenty-five.
 */
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const GRAVITY = 9.81;
const ZERO_RANGE = 200;

export const RIFLES = [
  { id: 'ranger', name: 'Ranger .308', zoom: 6, muzzle: 810, cycle: 0.95, mag: 5, reload: 2.4, sway: 0.62, steady: 1.25, spread: 0.0009 },
  { id: 'vector', name: 'Vector Semi', zoom: 4, muzzle: 760, cycle: 0.28, mag: 10, reload: 2.1, sway: 0.78, steady: 1.0, spread: 0.0021 },
  { id: 'longbow', name: 'Longbow .338', zoom: 12, muzzle: 900, cycle: 1.45, mag: 5, reload: 3.0, sway: 0.95, steady: 0.85, spread: 0.0005 },
  { id: 'anvil', name: 'Anvil .50', zoom: 20, muzzle: 860, cycle: 2.1, mag: 3, reload: 3.8, sway: 1.45, steady: 0.6, spread: 0.0004 }
];

const ZONE = { head: 3, body: 1, leg: 0.4 };
const MAX_BULLETS = 8;

export class WeaponSystem {
  static id = 'weapons';
  static deps = ['world', 'assets', 'render'];

  async init(ctx) {
    this.ctx = ctx;
    this.world = ctx.get('world');
    this.assets = ctx.get('assets');
    this.owned = [];

    this.player = {
      x: 0, z: 0, y: 0, eye: 1.62, yaw: 0, pitch: -0.04,
      crouch: 0, wantCrouch: false, moveMag: 0, bob: 0,
      scoped: false, scopeT: 0, breath: 1, holding: false,
      rifle: 0, ammo: RIFLES[0].mag, reloadT: 0, cycleT: 0,
      recoil: 0, recoilPitch: 0, swayT: 0
    };
    this.run = { score: 0, shots: 0, hits: 0, headshots: 0, longest: 0, taken: {} };

    this.bullets = [];
    for (let i = 0; i < MAX_BULLETS; i++) {
      this.bullets.push({ alive: false, x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, ox: 0, oy: 0, oz: 0, dist: 0, cand: [] });
    }
    this._aim = new THREE.Vector3();
    this._tmp = new THREE.Vector3();

    // Start on the highest ground within reach, so the first thing the player
    // sees is a view worth having a rifle for.
    let best = null;
    for (let i = 0; i < 240; i++) {
      const a = (i / 240) * Math.PI * 2 * 7, r = 30 + (i / 240) * 240;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = this.world.heightAt(x, z);
      if (this.world.slopeAt(x, z) > 0.3) continue;
      if (!best || h > best.h) best = { x, z, h };
    }
    if (best) { this.player.x = best.x; this.player.z = best.z; }
    this.player.y = this.world.heightAt(this.player.x, this.player.z);

    this.buildViewmodel(ctx);
  }

  get rifle() { return RIFLES[this.player.rifle]; }

  buildViewmodel(ctx) {
    if (this.vm) { ctx.overlayScene.remove(this.vm); this.vm = null; }
    const inst = this.assets.instance('rifle');
    if (!inst) return;
    // Held at the shoulder, canted slightly, muzzle downrange. The overlay
    // camera has its own near plane so none of it can clip into a rock.
    const holder = new THREE.Group();
    inst.rotation.set(0, Math.PI * 0.5, 0);
    inst.position.set(0, 0, 0);
    holder.add(inst);
    holder.scale.setScalar(0.42);
    holder.position.set(0.17, -0.20, -0.44);
    holder.rotation.set(0.02, 0.06, 0.015);
    this.vm = holder;
    this.vmModel = inst;
    ctx.overlayScene.add(holder);
    this.vmRest = holder.position.clone();
  }

  update(dt, ctx) {
    const p = this.player;
    const input = ctx.input;

    /* look — read actions, never key codes, so touch feeds the same values */
    const zoomEase = p.scoped ? 1 / Math.sqrt(this.rifle.zoom) : 1;
    p.yaw -= input.look.x * zoomEase;
    p.pitch = clamp(p.pitch - input.look.y * zoomEase, -1.3, 1.3);

    /* move */
    const ax = input.axis2();
    p.moveMag = Math.min(1, Math.hypot(ax.x, ax.y));
    p.wantCrouch = input.held('crouch');
    p.crouch += ((p.wantCrouch ? 1 : 0) - p.crouch) * clamp(dt * 5, 0, 1);
    const speed = lerp(4.4, 1.9, p.crouch) * (p.scoped ? 0.35 : 1);
    if (p.moveMag > 0.01) {
      const s = Math.sin(p.yaw), c = Math.cos(p.yaw);
      let nx = p.x + (-s * ax.y + c * ax.x) * speed * dt;
      let nz = p.z + (-c * ax.y - s * ax.x) * speed * dt;
      const rr = Math.hypot(nx, nz);
      if (rr > 330) { nx = nx / rr * 330; nz = nz / rr * 330; }
      if (this.world.slopeAt(nx, nz) < 0.66) { p.x = nx; p.z = nz; }
      p.bob += dt * speed * 1.5;
    }
    p.y = this.world.heightAt(p.x, p.z);
    p.eye = lerp(1.62, 0.98, p.crouch);

    /* scope, breath, timers */
    if (input.pressed('secondary')) p.scoped = !p.scoped;
    p.holding = input.held('sprint') && p.scoped;
    if (p.holding && p.breath > 0) { p.breath = Math.max(0, p.breath - dt * 0.34); if (!p.breath) p.holding = false; }
    else p.breath = Math.min(1, p.breath + dt * 0.22);
    p.scopeT += ((p.scoped ? 1 : 0) - p.scopeT) * clamp(dt * 9, 0, 1);
    if (p.cycleT > 0) p.cycleT = Math.max(0, p.cycleT - dt);
    if (p.reloadT > 0) { p.reloadT = Math.max(0, p.reloadT - dt); if (!p.reloadT) p.ammo = this.rifle.mag; }
    if (input.pressed('reload')) this.reload();
    p.recoil += (0 - p.recoil) * clamp(dt * 7, 0, 1);
    p.recoilPitch += (0 - p.recoilPitch) * clamp(dt * 5.5, 0, 1);
    p.swayT += dt;

    if (input.pressed('primary') || (input.held('primary') && this.rifle.cycle < 0.4)) this.fire(ctx);

    this.applyCamera(ctx, dt);
    this.stepBullets(dt, ctx);
  }

  /** Two out-of-phase Lissajous figures, so the reticle never repeats a loop
   *  the eye can learn. Crouching and held breath shrink it; the .50 does not. */
  swayAmount() {
    const p = this.player, r = this.rifle;
    const steady = r.steady * (1 + p.crouch * 0.5) * (p.holding ? 5.2 : 1);
    return (r.sway / steady) * (1 + p.moveMag * 2.4) * 0.0055;
  }

  aimDirection(out, withSway) {
    const p = this.player;
    const amt = withSway ? this.swayAmount() * p.scopeT : 0;
    const t = p.swayT;
    const yaw = p.yaw + (Math.sin(t * 0.83) * 0.62 + Math.sin(t * 2.17 + 1.1) * 0.26) * amt;
    const pitch = clamp(p.pitch + (Math.cos(t * 1.09) * 0.55 + Math.sin(t * 1.73 + 0.4) * 0.21) * amt + p.recoilPitch, -1.35, 1.35);
    return out.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).normalize();
  }

  applyCamera(ctx, dt) {
    const p = this.player, cam = ctx.camera;
    // In capture mode the shot list owns the camera. Driving it from here too
    // means every framing in the review set is silently the same one.
    if (!ctx.config.capture) {
      const bob = (1 - p.scopeT * 0.85) * p.moveMag * 0.045;
      cam.position.set(p.x + Math.sin(p.bob * 2) * bob, p.y + p.eye + Math.abs(Math.cos(p.bob * 2)) * bob * 0.8, p.z);
      this.aimDirection(this._aim, true);
      cam.lookAt(this._tmp.copy(cam.position).add(this._aim));
      const fov = lerp(ctx.config.fov ?? 62, (ctx.config.fov ?? 62) / this.rifle.zoom, p.scopeT);
      if (Math.abs(cam.fov - fov) > 0.001) { cam.fov = fov; cam.updateProjectionMatrix(); }
    }
    ctx.overlayCamera.quaternion.copy(cam.quaternion);
    if (this.vm) {
      // Scoping pulls the rifle back and centres it; recoil kicks it.
      const rest = this.vmRest;
      this.vm.position.set(
        lerp(rest.x, 0.002, p.scopeT),
        lerp(rest.y, -0.083, p.scopeT) - p.recoil * 0.02,
        lerp(rest.z, -0.30, p.scopeT) + p.recoil * 0.05
      );
      this.vm.rotation.z = lerp(0.015, 0, p.scopeT);
      this.vm.visible = p.scopeT < 0.985 && !this._vmForced;
    }
  }

  reload() {
    const p = this.player, r = this.rifle;
    if (p.reloadT > 0 || p.ammo >= r.mag) return;
    p.reloadT = r.reload;
  }

  selectRifle(i) {
    if (i < 0 || i >= RIFLES.length || i === this.player.rifle) return;
    this.player.rifle = i;
    this.player.ammo = RIFLES[i].mag;
    this.player.reloadT = 0;
    this.player.cycleT = 0.4;
  }

  fire(ctx) {
    const p = this.player, r = this.rifle;
    if (p.cycleT > 0 || p.reloadT > 0) return;
    if (p.ammo <= 0) { this.reload(); return; }
    const b = this.bullets.find((x) => !x.alive);
    if (!b) return;

    p.ammo--; p.cycleT = r.cycle; this.run.shots++;
    const cam = ctx.camera;
    this.aimDirection(this._aim, true);
    // Zeroed at 200 m: the bore points slightly above the sight line so a
    // close shot lands on the crosshair rather than under it.
    const tof = ZERO_RANGE / r.muzzle;
    this._aim.y += 0.5 * GRAVITY * tof * tof / ZERO_RANGE;
    const spread = r.spread * (p.scoped ? 1 : 7) * (1 + p.moveMag * 2);
    const rnd = ctx.rng;
    this._aim.x += (rnd.float() - 0.5) * spread;
    this._aim.y += (rnd.float() - 0.5) * spread;
    this._aim.normalize();

    b.alive = true;
    b.x = b.px = b.ox = cam.position.x;
    b.y = b.py = b.oy = cam.position.y;
    b.z = b.pz = b.oz = cam.position.z;
    b.vx = this._aim.x * r.muzzle; b.vy = this._aim.y * r.muzzle; b.vz = this._aim.z * r.muzzle;
    b.dist = 0;

    // Only animals roughly along the line can ever be hit, so the flight loop
    // tests a handful rather than the whole reserve, 280 times a second.
    b.cand.length = 0;
    const targets = ctx.peek('targets');
    if (targets) {
      for (const t of targets.list) {
        if (!t.alive) continue;
        const dx = t.x - b.x, dy = (t.y + 0.8) - b.y, dz = t.z - b.z;
        const proj = dx * this._aim.x + dy * this._aim.y + dz * this._aim.z;
        if (proj <= 0) continue;
        const ex = dx - this._aim.x * proj, ey = dy - this._aim.y * proj, ez = dz - this._aim.z * proj;
        if (ex * ex + ey * ey + ez * ez < 676) b.cand.push(t);
      }
      targets.spook += 0.55;
    }
    p.recoil = 1;
    p.recoilPitch = 0.006 + r.sway * 0.012;
    ctx.events.emit('weapon:fire', { rifle: r.id });
  }

  static segSphere(ax, ay, az, bx, by, bz, cx, cy, cz, rad) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len2 = dx * dx + dy * dy + dz * dz;
    if (len2 < 1e-9) return false;
    let t = ((cx - ax) * dx + (cy - ay) * dy + (cz - az) * dz) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t - cx, py = ay + dy * t - cy, pz = az + dz * t - cz;
    return px * px + py * py + pz * pz <= rad * rad;
  }

  stepBullets(dt, ctx) {
    const fx = ctx.peek('fx');
    const targets = ctx.peek('targets');
    for (const b of this.bullets) {
      if (!b.alive) continue;
      // Sub-step, or a 900 m/s round walks straight through a gazelle.
      const steps = Math.min(48, Math.max(1, Math.ceil(dt / 0.0035)));
      const h = dt / steps;
      for (let s = 0; s < steps && b.alive; s++) {
        b.px = b.x; b.py = b.y; b.pz = b.z;
        b.vy -= GRAVITY * h;
        b.x += b.vx * h; b.y += b.vy * h; b.z += b.vz * h;
        b.dist = Math.hypot(b.x - b.ox, b.y - b.oy, b.z - b.oz);

        for (const t of b.cand) {
          if (!t.alive) continue;
          const H = t.spec.height, L = t.spec.len;
          const hx = t.x + Math.sin(t.heading) * L * 0.42, hz = t.z + Math.cos(t.heading) * L * 0.42;
          if (WeaponSystem.segSphere(b.px, b.py, b.pz, b.x, b.y, b.z, hx, t.y + H * 0.9, hz, H * 0.24)) { this.hit(ctx, t, b, 'head'); b.alive = false; break; }
          if (WeaponSystem.segSphere(b.px, b.py, b.pz, b.x, b.y, b.z, t.x, t.y + H * 0.6, t.z, H * 0.42)) { this.hit(ctx, t, b, 'body'); b.alive = false; break; }
          if (WeaponSystem.segSphere(b.px, b.py, b.pz, b.x, b.y, b.z, t.x, t.y + H * 0.22, t.z, H * 0.3)) { this.hit(ctx, t, b, 'leg'); b.alive = false; break; }
        }
        if (!b.alive) break;
        for (const bl of this.world.blockers) {
          const dx = b.x - bl.x, dy = b.y - bl.y, dz = b.z - bl.z;
          if (dx * dx + dy * dy + dz * dz < bl.r * bl.r) { fx?.impact(b.x, b.y, b.z, 'wood'); b.alive = false; break; }
        }
        if (!b.alive) break;
        const gh = this.world.heightAt(b.x, b.z);
        if (b.y < gh) { fx?.impact(b.x, gh, b.z, 'dirt'); b.alive = false; break; }
        if (b.dist > 1500 || b.y > 400) { b.alive = false; break; }
      }
    }
    fx?.setTracers(this.bullets);
  }

  hit(ctx, t, b, zone) {
    const dist = Math.hypot(t.x - b.ox, t.y - b.oy, t.z - b.oz);
    const points = Math.round(t.spec.value * ZONE[zone] * (1 + clamp((dist - 90) / 380, 0, 2.4)));
    this.run.hits++;
    this.run.score += points;
    if (zone === 'head') this.run.headshots++;
    if (dist > this.run.longest) this.run.longest = dist;
    this.run.taken[t.key] = (this.run.taken[t.key] || 0) + 1;
    ctx.peek('fx')?.impact(b.x, b.y, b.z, 'hit');
    ctx.peek('fx')?.pop(t.x, t.y + t.spec.height, t.z, points, zone, t.spec.name, dist);
    ctx.events.emit('target:hit', { species: t.key, zone, distance: dist, points });
    const targets = ctx.peek('targets');
    if (zone === 'leg') { t.alert = 1.6; return; }
    targets?.kill(t);
    if (targets) targets.spook += 0.8;
  }

  /** Debug hook the shot list drives, so a framing can be captured on demand. */
  debugState(opts = {}) {
    if (opts.scoped !== undefined) { this.player.scoped = !!opts.scoped; this.player.scopeT = opts.scoped ? 1 : 0; }
    if (opts.rifle !== undefined) this.selectRifle(opts.rifle);
    if (opts.pos) { this.player.x = opts.pos[0]; this.player.z = opts.pos[2]; }
    if (opts.viewmodel !== undefined && this.vm) this.vm.visible = !!opts.viewmodel;
    this._vmForced = opts.viewmodel === false;
  }

  dispose() { for (const o of this.owned) { try { o.dispose(); } catch (e) { /* gone */ } } }
}
