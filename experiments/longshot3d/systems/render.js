import * as THREE from 'three';
import { compileMeshes, Owned } from '../lib/index.js';

/**
 * RENDER — owns the renderer, the light rig, the sky and the fog. Nothing else
 * touches renderer state.
 *
 * Deliberately a plain forward renderer with one shadow-casting sun. The light
 * count is FIXED for the life of the process: three bakes the number of visible
 * lights of each type into every program it compiles, so a light appearing
 * mid-game recompiles the world and drops a 700 ms frame on the floor.
 */

const SKY = { zenith: 0x2f6ea8, mid: 0x8fb8d8, horizon: 0xf6c88a };
const HAZE = 0xdcc7ad;
const FAR_BLUE = 0x9fb6cf;   // what distance actually does to a rock face

export class RenderSystem {
  static id = 'render';
  static deps = [];

  async init(ctx) {
    this.ctx = ctx;
    this.own = new Owned();
    const q = ctx.config.q;

    const renderer = new THREE.WebGLRenderer({
      canvas: ctx.canvas, antialias: true, alpha: false,
      stencil: false, powerPreference: 'high-performance'
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = ctx.config.exposure ?? 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = this.own.add(renderer);
    this.scale = q.renderScale;

    /* --- the fixed rig --------------------------------------------------- */
    this.sun = new THREE.DirectionalLight(0xffd9a0, 3.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 260;
    const ext = 62;
    Object.assign(this.sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext });
    // Bias tuned at one map size peters or acnes at another, so scale it.
    this.sun.shadow.bias = -0.0007 * (2048 / q.shadowMapSize);
    this.sun.shadow.normalBias = 0.035;
    this.hemi = new THREE.HemisphereLight(0xbcd9f2, 0x6a5836, 1.05);
    // A cool bounce from the opposite side, so shadowed flanks are not black.
    this.bounce = new THREE.DirectionalLight(0x9fc0e8, 0.5);
    this.bounce.position.set(-40, 18, -30);
    ctx.scene.add(this.sun, this.sun.target, this.hemi, this.bounce);

    // The viewmodel gets its own two lights so the rifle reads regardless of
    // where the player is standing.
    this.vmKey = new THREE.DirectionalLight(0xfff0d8, 2.6);
    this.vmKey.position.set(1.4, 2.2, 1.8);
    this.vmFill = new THREE.HemisphereLight(0xcfe2f5, 0x3a3228, 1.1);
    ctx.overlayScene.add(this.vmKey, this.vmFill);

    /* --- air, so distance reads as distance ------------------------------ */
    ctx.scene.fog = new THREE.FogExp2(HAZE, 0.0013);
    ctx.scene.background = new THREE.Color(SKY.horizon);

    this.buildSky(ctx);
    this.buildMountains(ctx);
    this.buildClouds(ctx);

    this._sunDir = new THREE.Vector3();
    this.setSun(14);
  }

  own_(o) { return this.own.add(o); }

  /** A vertex-coloured dome rather than a shader: one fewer program to compile
   *  and the gradient is authored, not fitted. */
  buildSky(ctx) {
    const geo = this.own.add(new THREE.SphereGeometry(1050, 40, 24));
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cz = new THREE.Color(SKY.zenith), cm = new THREE.Color(SKY.mid), ch = new THREE.Color(SKY.horizon);
    const col = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 1050;
      const t = Math.max(0, Math.min(1, (y + 0.12) / 1.12));
      if (t < 0.42) col.copy(ch).lerp(cm, (t / 0.42) ** 0.8);
      else col.copy(cm).lerp(cz, ((t - 0.42) / 0.58) ** 0.9);
      colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = this.own.add(new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false
    }));
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    ctx.scene.add(this.sky);

    const disc = this.own.add(new THREE.SphereGeometry(15, 16, 12));
    this.sunDisc = new THREE.Mesh(disc, this.own.add(new THREE.MeshBasicMaterial({
      color: 0xfffdf0, fog: false, depthWrite: false
    })));
    const glow = this.own.add(new THREE.SphereGeometry(58, 16, 12));
    this.sunGlow = new THREE.Mesh(glow, this.own.add(new THREE.MeshBasicMaterial({
      color: 0xffd9a0, fog: false, transparent: true, opacity: 0.22,
      depthWrite: false, blending: THREE.AdditiveBlending
    })));
    this.sunDisc.frustumCulled = false; this.sunGlow.frustumCulled = false;
    ctx.scene.add(this.sunDisc, this.sunGlow);
  }

  /** One ring of peaks as a single geometry, coloured toward the haze so the
   *  fog does most of the work and the silhouette does the rest. */
  buildMountains(ctx) {
    const rand = ctx.rng.fork('mountains');
    const SEG = 240;
    const cRock = new THREE.Color(0x5d6472), cHaze = new THREE.Color(FAR_BLUE);
    const lo = new THREE.Color(), hi = new THREE.Color();
    // Two ridgelines at different distances. The near one occludes the far one,
    // which is what reads as depth rather than as a painted backdrop.
    const verts = [], cols = [];
    for (let layer = 0; layer < 2; layer++) {
      const radius = layer === 0 ? 860 : 780;
      const hazeMix = layer === 0 ? 0.80 : 0.58;
      const scale = layer === 0 ? 1.0 : 0.72;
      const phase = layer * 3.7;
      const ridge = new Float32Array(SEG + 1);
      for (let i = 0; i <= SEG; i++) {
        const a = (i / SEG) * Math.PI * 2;
        // Sum of three sines with incommensurate periods: a skyline that never
        // visibly repeats, and no noise lookup per vertex.
        const h = 0.55 + 0.30 * Math.sin(a * 3 + phase)
                       + 0.22 * Math.sin(a * 7.3 + phase * 2.1)
                       + 0.14 * Math.sin(a * 13.7 + phase * 0.6)
                       + 0.09 * Math.sin(a * 23.1 + phase * 3.3);
        ridge[i] = Math.max(24, h * 210 * scale);
      }
      ridge[SEG] = ridge[0];
      for (let i = 0; i < SEG; i++) {
        const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2;
        const x0 = Math.cos(a0) * radius, z0 = Math.sin(a0) * radius;
        const x1 = Math.cos(a1) * radius, z1 = Math.sin(a1) * radius;
        const h0 = ridge[i], h1 = ridge[i + 1];
        verts.push(x0, -40, z0, x1, -40, z1, x1, h1, z1);
        verts.push(x0, -40, z0, x1, h1, z1, x0, h0, z0);
        lo.copy(cRock).lerp(cHaze, hazeMix);
        for (let k = 0; k < 6; k++) {
          // Peaks sit deeper in the haze than their own feet do.
          const isTop = (k === 2 || k === 4 || k === 5);
          hi.copy(cRock).lerp(cHaze, isTop ? Math.min(0.95, hazeMix + 0.09) : hazeMix);
          cols.push(hi.r, hi.g, hi.b);
        }
      }
    }
    const geo = this.own.add(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    this.mountains = new THREE.Mesh(geo, this.own.add(new THREE.MeshBasicMaterial({
      vertexColors: true, fog: true, side: THREE.DoubleSide
    })));
    this.mountains.frustumCulled = false;
    ctx.scene.add(this.mountains);
  }

  buildClouds(ctx) {
    const rand = ctx.rng.fork('clouds');
    const geo = this.own.add(new THREE.IcosahedronGeometry(1, 1).scale(1, 0.42, 1));
    const mat = this.own.add(new THREE.MeshBasicMaterial({
      color: 0xffffff, fog: false, transparent: true, opacity: 0.7, depthWrite: false
    }));
    const N = 40 * 4;
    const mesh = new THREE.InstancedMesh(geo, mat, N);
    mesh.frustumCulled = false;
    const m = new THREE.Matrix4(), col = new THREE.Color(), tint = new THREE.Color(SKY.horizon);
    let n = 0;
    for (let i = 0; i < 40; i++) {
      const a = rand.float() * Math.PI * 2, r = 260 + rand.float() * 640;
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r, cy = 200 + rand.float() * 140;
      const scale = 30 + rand.float() * 55;
      for (let p = 0; p < 4 && n < N; p++) {
        m.makeScale(scale * (0.6 + rand.float() * 0.7), scale * (0.45 + rand.float() * 0.5), scale * (0.6 + rand.float() * 0.7));
        m.setPosition(cx + (rand.float() - 0.5) * scale * 2.6, cy + (rand.float() - 0.5) * scale * 0.5, cz + (rand.float() - 0.5) * scale * 2.6);
        mesh.setMatrixAt(n, m);
        mesh.setColorAt(n, col.setRGB(1, 1, 1).lerp(tint, rand.float() * 0.4));
        n++;
      }
    }
    for (; n < N; n++) { m.makeScale(0, 0, 0); mesh.setMatrixAt(n, m); }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.clouds = mesh;
    ctx.scene.add(mesh);
  }

  /** Deterministic: a pure function of the hour, never of wall-clock time. */
  setSun(hour) {
    this.hour = hour;
    const t = ((hour - 6) / 12) * Math.PI;
    const elev = Math.sin(t);
    const day = Math.max(0.06, elev);
    this._sunDir.set(Math.cos(t) * 0.9, Math.max(0.05, elev), 0.35).normalize();
    this.sun.intensity = 0.5 + 3.6 * day;
    this.sun.color.setHSL(0.085 - 0.03 * (1 - day), 0.62 - 0.3 * day, 0.52);
    this.hemi.intensity = 0.5 + 0.9 * day;
    return hour;
  }

  get screenSize() { return { width: this._w ?? 1, height: this._h ?? 1 }; }

  resize(w, h) {
    this._w = w; this._h = h;
    // A budget from the preset, not a constant: a phone reports DPR 3 and will
    // happily be asked for 3.5x the pixels of a 1080p laptop.
    const cap = this.ctx.config.q.maxPixelRatio ?? 2;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, cap) * this.scale);
    this.renderer.setSize(w, h, false);
  }

  lateUpdate(dt, ctx) {
    const cam = ctx.camera;
    // Sky, sun and clouds ride with the camera so they never get closer.
    this.sky.position.copy(cam.position);
    this.clouds.position.set(cam.position.x, 0, cam.position.z);
    this.mountains.position.set(cam.position.x, 0, cam.position.z);
    this.sunDisc.position.copy(cam.position).addScaledVector(this._sunDir, 940);
    this.sunGlow.position.copy(this.sunDisc.position);

    // Keep the shadow frustum on the camera, snapped to texel size — un-snapped
    // fitting is what reviewers report as "flickering shadows" while walking.
    this.sun.target.position.set(cam.position.x, 0, cam.position.z);
    const texel = (2 * 62) / ctx.config.q.shadowMapSize;
    this.sun.target.position.x = Math.round(this.sun.target.position.x / texel) * texel;
    this.sun.target.position.z = Math.round(this.sun.target.position.z / texel) * texel;
    this.sun.position.copy(this.sun.target.position).addScaledVector(this._sunDir, 120);
    this.sun.target.updateMatrixWorld();
  }

  render(ctx) {
    const r = this.renderer;
    // autoClear must be OFF for the second pass or render() clears the COLOUR
    // buffer too and the overlay is composited onto a black frame — the world
    // disappears and only the viewmodel survives.
    r.autoClear = true;
    r.info.autoReset = false;
    r.info.reset();
    r.render(ctx.scene, ctx.camera);
    if (this.hasOverlay(ctx)) {
      r.autoClear = false;
      r.clearDepth();
      r.render(ctx.overlayScene, ctx.overlayCamera);
      r.autoClear = true;
    }
  }

  /** Lights do not draw, so counting children would run the overlay pass for
   *  an empty scene — a clear and a state change for nothing. */
  hasOverlay(ctx) {
    let n = 0;
    ctx.overlayScene.traverse((o) => { if (o.isMesh && o.visible) n++; });
    return n > 0;
  }

  resetTemporal() { return true; }

  async prewarmMaterials(ctx) {
    const meshes = [];
    ctx.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
    ctx.overlayScene.traverse((o) => { if (o.isMesh) meshes.push(o); });
    const compiled = compileMeshes(this.renderer, meshes, ctx.scene, ctx.camera);
    return { ok: true, compiled, meshes: meshes.length };
  }

  dispose() { this.own.disposeAll(); }
}
