import * as THREE from 'three';
import { TouchControls } from '../lib/index.js';

/**
 * UI — a DOM overlay, because a HUD wants real text at real sizes and a canvas
 * one never quite gets there on a phone.
 *
 * Every pressable thing is at least 44 CSS px, which is the floor for a thumb.
 * The touch layer stays hidden until a real finger arrives, so a headless
 * capture never sees it and the pixel gate is unaffected.
 */
export class UiSystem {
  static id = 'ui';
  static deps = ['weapons', 'targets'];

  async init(ctx) {
    this.ctx = ctx;
    this.weapons = ctx.get('weapons');
    this.root = document.getElementById('ui');
    this.root.innerHTML = `
      <style>
        .hud{position:absolute;inset:0}
        .tl{position:absolute;top:14px;left:16px;line-height:1.5}
        .tr{position:absolute;top:14px;right:16px;text-align:right;line-height:1.5}
        .bl{position:absolute;bottom:18px;left:16px}
        .br{position:absolute;bottom:18px;right:16px;text-align:right}
        .big{font-size:22px;font-weight:600;letter-spacing:.5px}
        .dim{opacity:.62}
        .warn{color:#ffb457}
        .reticle{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)}
        .breath{width:120px;height:4px;background:rgba(255,255,255,.2);margin-top:5px;border-radius:2px;overflow:hidden}
        .breath i{display:block;height:100%;background:#7fd2ff}
        .pops{position:absolute;inset:0;overflow:hidden}
        .pop{position:absolute;transform:translate(-50%,-50%);font-weight:600;white-space:nowrap;text-align:center}
        .scope{position:absolute;inset:0;pointer-events:none;opacity:0;transition:none}
      </style>
      <div class="hud">
        <svg class="scope" viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs><radialGradient id="v"><stop offset="68%" stop-color="rgba(0,0,0,0)"/><stop offset="80%" stop-color="rgba(0,0,0,.88)"/><stop offset="100%" stop-color="#000"/></radialGradient></defs>
          <rect width="100" height="100" fill="url(#v)"/>
        </svg>
        <svg class="reticle" width="200" height="200" viewBox="-100 -100 200 200"></svg>
        <div class="tl"><div class="big" id="score">0</div><div class="dim" id="acc">0 shots</div></div>
        <div class="tr"><div id="rng" class="big dim">—</div><div class="dim" id="rifle"></div></div>
        <div class="bl"><div id="ammo" class="big">5</div><div class="dim">breath</div><div class="breath"><i id="breath" style="width:100%"></i></div></div>
        <div class="br dim" id="hint">drag look · WASD move · RMB scope · Shift hold breath</div>
        <div class="pops" id="pops"></div>
      </div>`;
    this.el = {
      score: this.root.querySelector('#score'), acc: this.root.querySelector('#acc'),
      rng: this.root.querySelector('#rng'), rifle: this.root.querySelector('#rifle'),
      ammo: this.root.querySelector('#ammo'), breath: this.root.querySelector('#breath'),
      pops: this.root.querySelector('#pops'), scope: this.root.querySelector('.scope'),
      reticle: this.root.querySelector('.reticle'), hint: this.root.querySelector('#hint')
    };
    this.drawReticle(false);
    this._ray = new THREE.Raycaster();
    this._dir = new THREE.Vector3();

    // Touch input with no visible controls is the most common mobile failure,
    // and it does not look like a bug: the player taps once and leaves.
    if (!ctx.config.capture) {
      this.touch = new TouchControls(ctx.input, {
        buttons: [
          { action: 'primary', label: 'FIRE' },
          { action: 'secondary', label: 'SCOPE' },
          { action: 'crouch', label: 'CROUCH' },
          { action: 'reload', label: 'RELOAD' }
        ]
      });
      this.touch.mount?.(document.body);
    }
  }

  drawReticle(scoped) {
    const s = this.el.reticle;
    if (this._scopedReticle === scoped) return;
    this._scopedReticle = scoped;
    if (scoped) {
      // Mil-dot: the dots are the holdover marks you actually use past the zero.
      let dots = '';
      for (let i = 1; i <= 5; i++) dots += `<circle cx="0" cy="${i * 13}" r="1.5" fill="#0d0d0d"/>`;
      for (let i = 1; i <= 4; i++) dots += `<circle cx="${i * 13}" cy="0" r="1.5" fill="#0d0d0d"/><circle cx="${-i * 13}" cy="0" r="1.5" fill="#0d0d0d"/>`;
      s.innerHTML = `<g stroke="#0d0d0d" stroke-width="1.6" fill="none">
        <line x1="-92" y1="0" x2="-8" y2="0"/><line x1="8" y1="0" x2="92" y2="0"/>
        <line x1="0" y1="-92" x2="0" y2="-8"/><line x1="0" y1="8" x2="0" y2="92"/>
      </g>${dots}<circle cx="0" cy="0" r="1.1" fill="#c8332a"/>`;
    } else {
      s.innerHTML = `<g stroke="rgba(255,255,255,.85)" stroke-width="1.6" fill="none">
        <line x1="-14" y1="0" x2="-5" y2="0"/><line x1="5" y1="0" x2="14" y2="0"/>
        <line x1="0" y1="-14" x2="0" y2="-5"/><line x1="0" y1="5" x2="0" y2="14"/>
      </g><circle cx="0" cy="0" r="1" fill="rgba(255,255,255,.9)"/>`;
    }
  }

  /** Range to whatever is under the crosshair — the number a marksman reads. */
  rangeUnderCrosshair(ctx) {
    const w = ctx.get('world');
    const cam = ctx.camera;
    cam.getWorldDirection(this._dir);
    let t = 0;
    // March the ray until it goes under the ground: cheap, and exact enough
    // for a readout quantised to five metres.
    for (let i = 0; i < 90; i++) {
      t += 12;
      const x = cam.position.x + this._dir.x * t;
      const y = cam.position.y + this._dir.y * t;
      const z = cam.position.z + this._dir.z * t;
      if (y < w.heightAt(x, z)) return t;
      if (t > 1100) break;
    }
    return null;
  }

  lateUpdate(dt, ctx) {
    const p = this.weapons.player, run = this.weapons.run, r = this.weapons.rifle;
    this.el.score.textContent = run.score.toLocaleString();
    const acc = run.shots ? Math.round((run.hits / run.shots) * 100) : 0;
    this.el.acc.textContent = `${run.shots} shots · ${acc}% · best ${Math.round(run.longest)} m`;
    this.el.ammo.textContent = p.reloadT > 0 ? 'reloading' : `${p.ammo} / ${r.mag}`;
    this.el.ammo.className = 'big' + (p.ammo === 0 && p.reloadT <= 0 ? ' warn' : '');
    this.el.rifle.textContent = `${r.name} · ${r.zoom}x`;
    this.el.breath.style.width = (p.breath * 100).toFixed(0) + '%';
    const rng = this.rangeUnderCrosshair(ctx);
    this.el.rng.textContent = rng ? `${Math.round(rng / 5) * 5} m` : '—';
    this.el.scope.style.opacity = p.scopeT.toFixed(3);
    this.drawReticle(p.scopeT > 0.5);
    if (ctx.input.touchActive && this.el.hint) { this.el.hint.remove(); this.el.hint = null; }

    // Score pops, projected from world space each frame.
    const fx = ctx.peek('fx');
    if (!fx) return;
    const host = this.el.pops;
    while (host.childElementCount > fx.pops.length) host.lastChild.remove();
    while (host.childElementCount < fx.pops.length) {
      const d = document.createElement('div');
      d.className = 'pop';
      host.appendChild(d);
    }
    const v = this._v || (this._v = new THREE.Vector3());
    for (let i = 0; i < fx.pops.length; i++) {
      const o = fx.pops[i], el = host.children[i];
      v.set(o.x, o.y + 0.4 + o.t * 0.8, o.z).project(ctx.camera);
      if (v.z > 1) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.left = ((v.x * 0.5 + 0.5) * 100) + '%';
      el.style.top = ((-v.y * 0.5 + 0.5) * 100) + '%';
      el.style.opacity = String(Math.max(0, 1 - o.t / 1.9));
      el.style.color = o.zone === 'head' ? '#ffd86b' : '#eaf2fb';
      el.innerHTML = `+${o.points}<br><span style="font-size:11px;opacity:.75">${o.name} · ${Math.round(o.dist)} m${o.zone === 'head' ? ' · HEAD' : ''}</span>`;
    }
  }

  dispose() { this.touch?.destroy?.(); }
}
