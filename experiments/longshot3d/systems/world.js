import * as THREE from 'three';

/**
 * WORLD — the ground and everything rooted in it.
 *
 * Owns: the height field, the terrain mesh, all instanced scatter, and the two
 * queries the rest of the game asks about the ground:
 *   heightAt(x,z)      where the ground is  (player feet, animal feet, bullets)
 *   concealmentAt(x,z) how hidden a point is (the whole stealth mechanic)
 *
 * Nothing here is loaded. Terrain, grass, scrub, trees and rocks are generated,
 * which costs nothing to download and is why the only bytes this game fetches
 * are the two Thrixel assets.
 */

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (t) => t * t * (3 - 2 * t);

export const WORLD_SIZE = 1100;
export const PLAY_RADIUS = 340;

/** Value noise + fbm, seeded, so the same seed is the same reserve. */
function makeNoise(rand) {
  const perm = new Uint8Array(512);
  const src = new Uint8Array(256);
  for (let i = 0; i < 256; i++) src[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = src[i]; src[i] = src[j]; src[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = src[i & 255];
  const grad = (ix, iz) => (perm[(ix + perm[iz & 255]) & 255] / 255) * 2 - 1;
  function noise2(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const u = smoothstep(fx), v = smoothstep(fz);
    return lerp(lerp(grad(ix, iz), grad(ix + 1, iz), u),
                lerp(grad(ix, iz + 1), grad(ix + 1, iz + 1), u), v);
  }
  function fbm(x, z, oct, lac, gain) {
    let sum = 0, amp = 1, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) { sum += noise2(x * f, z * f) * amp; norm += amp; amp *= gain; f *= lac; }
    return sum / norm;
  }
  return { noise2, fbm };
}

const PALETTE = {
  grass: 0xb39a56, dry: 0xd6bd7c, dirt: 0x8d7043, rock: 0x8b8478,
  leafA: 0x6d7d3e, leafB: 0x93a055, bark: 0x574533, scrub: 0x8b8a4d
};

export class WorldSystem {
  static id = 'world';
  static deps = ['render'];

  async init(ctx) {
    const rand = ctx.rng.fork('world').float.bind(ctx.rng.fork('world'));
    this.rand = rand;
    this.noise = makeNoise(rand);
    this.covers = [];     // { x, z, r, strength } — scrub you can hide in
    this.blockers = [];   // { x, y, z, r }        — trunks and boulders stop bullets
    this.owned = [];
    this.group = new THREE.Group();
    ctx.scene.add(this.group);

    this.buildTerrain(ctx);
    this.buildScatter(ctx);
  }

  /** Shared by the mesh, the scatterer, the player's feet and every bullet, so
   *  nothing in the game can disagree about where the ground is. */
  heightAt(x, z) {
    const n = this.noise;
    const base = n.fbm(x * 0.0026, z * 0.0026, 5, 2.07, 0.5);
    const ridge = 1 - Math.abs(n.fbm(x * 0.0061 + 91, z * 0.0061 - 47, 3, 2.2, 0.55));
    const dune = n.fbm(x * 0.011, z * 0.011, 2, 2.3, 0.5);
    let h = base * 46 + (ridge - 0.5) * 26 + dune * 3.2;
    const d = Math.hypot(x, z);
    // A shallow basin in the middle: somewhere to stand that can see out.
    const bowl = smoothstep(clamp(d / (PLAY_RADIUS * 1.5), 0, 1));
    h = lerp(h * 0.55 - 3, h, bowl);
    // Lift the far ring so the horizon is land, not a cut edge.
    const far = smoothstep(clamp((d - PLAY_RADIUS * 1.25) / (WORLD_SIZE * 0.4), 0, 1));
    return h + far * 62;
  }

  normalAt(x, z, out) {
    const e = 1.6;
    out.set(this.heightAt(x - e, z) - this.heightAt(x + e, z), 2 * e,
            this.heightAt(x, z - e) - this.heightAt(x, z + e)).normalize();
    return out;
  }

  slopeAt(x, z) {
    const n = this._n || (this._n = new THREE.Vector3());
    this.normalAt(x, z, n);
    return 1 - clamp(n.y, 0, 1);
  }

  /** 0 in the open, 1 deep in a thicket. The animals read this off the player. */
  concealmentAt(x, z) {
    let best = 0;
    const c = this.covers;
    for (let i = 0; i < c.length; i++) {
      const o = c[i];
      const dx = x - o.x, dz = z - o.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > o.r * o.r) continue;
      const v = o.strength * smoothstep(clamp((1 - Math.sqrt(d2) / o.r) * 1.3, 0, 1));
      if (v > best) best = v;
    }
    return best;
  }

  /** Does a straight line from a to b pass through a trunk or a boulder? */
  blocked(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1) return false;
    const ix = dx / len, iy = dy / len, iz = dz / len;
    const bl = this.blockers;
    for (let i = 0; i < bl.length; i++) {
      const o = bl[i];
      const ox = o.x - ax, oy = o.y - ay, oz = o.z - az;
      const proj = ox * ix + oy * iy + oz * iz;
      if (proj <= 0 || proj >= len) continue;
      const px = ox - ix * proj, py = oy - iy * proj, pz = oz - iz * proj;
      if (px * px + py * py + pz * pz < o.r * o.r) return true;
    }
    return false;
  }

  own(o) { this.owned.push(o); return o; }

  buildTerrain(ctx) {
    const seg = ctx.config.q.terrainSeg || 190;
    const geo = this.own(new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, seg, seg));
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cGrass = new THREE.Color(PALETTE.grass), cDry = new THREE.Color(PALETTE.dry);
    const cDirt = new THREE.Color(PALETTE.dirt), cRock = new THREE.Color(PALETTE.rock);
    const col = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = this.heightAt(x, z);
      pos.setY(i, h);
      // Patchiness, then slope, then altitude — in that order the rock reads
      // as exposed stone rather than a colour ramp.
      // Low ground holds moisture, so it is greener; rises bleach out. That
      // one correlation is what stops a heightfield reading as a sand table.
      const damp = clamp(1 - (h + 6) / 46, 0, 1);
      const patch = this.noise.fbm(x * 0.014, z * 0.014, 4, 2.1, 0.55) * 0.5 + 0.5;
      col.copy(cDry).lerp(cGrass, clamp(damp * 0.85 + patch * 0.55 - 0.2, 0, 1));
      // Bare soil where the grass has been walked or burnt off.
      const bare = this.noise.fbm(x * 0.031 + 210, z * 0.031 - 88, 3, 2.2, 0.5) * 0.5 + 0.5;
      col.lerp(cDirt, clamp((bare - 0.62) * 2.6, 0, 1) * 0.75);
      // A broad mottle, so the eye finds something at every distance.
      const mottle = this.noise.fbm(x * 0.0055, z * 0.0055, 2, 2.1, 0.5);
      col.multiplyScalar(1 + mottle * 0.16);
      const s = this.slopeAt(x, z);
      if (s > 0.22) col.lerp(cDirt, clamp((s - 0.22) / 0.3, 0, 1));
      if (s > 0.46) col.lerp(cRock, clamp((s - 0.46) / 0.34, 0, 1));
      const g = 0.90 + this.noise.noise2(x * 0.09, z * 0.09) * 0.14;
      colors[i * 3] = col.r * g; colors[i * 3 + 1] = col.g * g; colors[i * 3 + 2] = col.b * g;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    // Tessellated on purpose: a two-triangle floor cannot take a light
    // gradient, which is what makes cheap ground look like paper.
    const mat = this.own(new THREE.MeshLambertMaterial({ vertexColors: true }));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    this.terrain = mesh;
  }

  tuftGeometry() {
    const v = [], c = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + 0.4;
      const lean = 0.22 + (i % 3) * 0.09, h = 0.75 + (i % 2) * 0.35, w = 0.07;
      const dx = Math.cos(a), dz = Math.sin(a);
      v.push(-dz * w, 0, dx * w, dz * w, 0, -dx * w, dx * lean, h, dz * lean);
      c.push(0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1, 1, 1);
    }
    const g = this.own(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    g.computeVertexNormals();
    return g;
  }

  /** Weld n flattened blobs into one crown geometry. One umbrella disc on a
   *  stick reads as a mushroom; three offset ones read as a tree. */
  crownGeometry(seed) {
    let s = seed >>> 0 || 1;
    const r = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    const parts = [];
    const lobes = 3;
    for (let i = 0; i < lobes; i++) {
      const g = new THREE.IcosahedronGeometry(1, 1).toNonIndexed();
      const sx = 0.55 + r() * 0.55, sy = 0.26 + r() * 0.16, sz = 0.55 + r() * 0.55;
      g.scale(sx, sy, sz);
      const a = (i / lobes) * Math.PI * 2 + r();
      g.translate(Math.cos(a) * (0.34 + r() * 0.3), (r() - 0.5) * 0.18, Math.sin(a) * (0.34 + r() * 0.3));
      parts.push(g);
    }
    let total = 0;
    for (const g of parts) total += g.attributes.position.count;
    const position = new Float32Array(total * 3), normal = new Float32Array(total * 3);
    let o = 0;
    for (const g of parts) {
      const gp = g.attributes.position, gn = g.attributes.normal;
      for (let i = 0; i < gp.count; i++) {
        position[(o + i) * 3] = gp.getX(i); position[(o + i) * 3 + 1] = gp.getY(i); position[(o + i) * 3 + 2] = gp.getZ(i);
        normal[(o + i) * 3] = gn.getX(i); normal[(o + i) * 3 + 1] = gn.getY(i); normal[(o + i) * 3 + 2] = gn.getZ(i);
      }
      o += gp.count;
      g.dispose();
    }
    const geo = this.own(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    return geo;
  }

  blobGeometry(detail, squash, seed) {
    const g = this.own(new THREE.IcosahedronGeometry(1, detail));
    const pos = g.attributes.position;
    let s = seed >>> 0 || 1;
    const r = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    for (let i = 0; i < pos.count; i++) {
      const k = 0.74 + r() * 0.5;
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * squash, pos.getZ(i) * k);
    }
    g.computeVertexNormals();
    return g;
  }

  placeable(x, z) { return this.slopeAt(x, z) < 0.42; }

  buildScatter(ctx) {
    const q = ctx.config.q;
    const rand = this.rand;
    const m4 = new THREE.Matrix4(), quat = new THREE.Quaternion();
    const v3 = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0), nrm = new THREE.Vector3();

    const mk = (geo, mat, n) => {
      // frustumCulled off: three culls an InstancedMesh against its geometry's
      // bounding sphere at the MESH origin, so a whole field of grass vanishes
      // the moment that origin leaves the frustum.
      const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.group.add(mesh);
      return mesh;
    };

    // Ground decals under everything that stands up: an order of magnitude
    // cheaper than a shadow map and it cannot acne, crawl or peter.
    const shadeGeo = this.own(new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2));
    const shadeMat = this.own(new THREE.MeshBasicMaterial({
      color: 0x1a1408, transparent: true, opacity: 0.34, depthWrite: false
    }));
    const nGrass = (q.grass ?? 3200) * 2, nBush = q.bush ?? 520, nTree = q.tree ?? 260, nRock = q.rock ?? 300;
    const shade = mk(shadeGeo, shadeMat, nBush + nTree + nRock);
    let sN = 0;
    const putShade = (x, z, r) => {
      this.normalAt(x, z, nrm);
      quat.setFromUnitVectors(up, nrm);
      m4.compose(v3.set(x, this.heightAt(x, z) + 0.06, z), quat, sc.set(r, 1, r));
      shade.setMatrixAt(sN++, m4);
    };

    const lA = new THREE.Color(PALETTE.leafA), lB = new THREE.Color(PALETTE.leafB);

    /* grass */
    const grass = mk(this.tuftGeometry(),
      this.own(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })), nGrass);
    const cA = new THREE.Color(PALETTE.grass), cB = new THREE.Color(PALETTE.scrub);
    let gi = 0;
    let clumpX = 0, clumpZ = 0, clumpLeft = 0;
    for (let i = 0; i < nGrass * 4 && gi < nGrass; i++) {
      if (clumpLeft <= 0) {
        const ca = rand() * TAU, cr = Math.sqrt(rand()) * PLAY_RADIUS * 1.4;
        clumpX = Math.cos(ca) * cr; clumpZ = Math.sin(ca) * cr;
        clumpLeft = 4 + Math.floor(rand() * 9);
      }
      clumpLeft--;
      const x = clumpX + (rand() - 0.5) * 7, z = clumpZ + (rand() - 0.5) * 7;
      if (!this.placeable(x, z)) continue;
      const s = 0.7 + rand() * 1.1;
      quat.setFromAxisAngle(up, rand() * TAU);
      m4.compose(v3.set(x, this.heightAt(x, z) - 0.05, z), quat, sc.set(s * 0.85, s * (0.5 + rand() * 0.45), s * 0.85));
      grass.setMatrixAt(gi, m4);
      grass.setColorAt(gi, col.copy(cA).lerp(cB, rand()).multiplyScalar(0.82 + rand() * 0.36));
      gi++;
    }
    grass.count = gi;

    /* scrub — the cover the stealth mechanic reads */
    const bush = mk(this.blobGeometry(1, 0.78, 0x51ee7),
      this.own(new THREE.MeshLambertMaterial({ flatShading: true })), nBush);
    let bi = 0;
    for (let i = 0; i < nBush * 4 && bi < nBush; i++) {
      const a = rand() * TAU, r = Math.sqrt(rand()) * PLAY_RADIUS * 1.3;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!this.placeable(x, z)) continue;
      const s = 1.15 + rand() * 1.5;
      quat.setFromAxisAngle(up, rand() * TAU);
      m4.compose(v3.set(x, this.heightAt(x, z) + s * 0.42, z), quat, sc.set(s, s * (0.7 + rand() * 0.4), s));
      bush.setMatrixAt(bi, m4);
      bush.setColorAt(bi, col.copy(lA).lerp(lB, rand()).multiplyScalar(0.84 + rand() * 0.3));
      this.covers.push({ x, z, r: s * 1.3, strength: clamp(s / 2.4, 0.35, 0.95) });
      putShade(x, z, s * 1.15);
      bi++;
    }
    bush.count = bi;

    /* acacias — trunk and canopy share one transform list */
    const trunkGeo = this.own(new THREE.CylinderGeometry(0.16, 0.34, 1, 6, 1).translate(0, 0.5, 0));
    const trunk = mk(trunkGeo, this.own(new THREE.MeshLambertMaterial({ color: PALETTE.bark })), nTree);
    const canopy = mk(this.crownGeometry(0x9a13),
      this.own(new THREE.MeshLambertMaterial({ flatShading: true })), nTree);
    let ti = 0;
    for (let i = 0; i < nTree * 5 && ti < nTree; i++) {
      const a = rand() * TAU, r = Math.sqrt(rand()) * PLAY_RADIUS * 1.5;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!this.placeable(x, z)) continue;
      const h = 3.4 + rand() * 4.4, spread = h * (0.52 + rand() * 0.3), y = this.heightAt(x, z);
      quat.setFromAxisAngle(up, rand() * TAU);
      m4.compose(v3.set(x, y, z), quat, sc.set(1, h, 1));
      trunk.setMatrixAt(ti, m4);
      m4.compose(v3.set(x, y + h * 0.92, z), quat, sc.set(spread * 1.5, spread * 1.15, spread * 1.5));
      canopy.setMatrixAt(ti, m4);
      canopy.setColorAt(ti, col.copy(lA).lerp(lB, rand() * 0.8).multiplyScalar(0.78 + rand() * 0.34));
      this.covers.push({ x, z, r: spread * 0.55, strength: 0.5 });
      this.blockers.push({ x, y: y + h * 0.9, z, r: spread * 0.5 });
      putShade(x, z, spread * 0.9);
      ti++;
    }
    trunk.count = ti; canopy.count = ti;

    /* boulders */
    const rock = mk(this.blobGeometry(0, 0.72, 0x1234),
      this.own(new THREE.MeshLambertMaterial({ flatShading: true })), nRock);
    const cRock = new THREE.Color(PALETTE.rock);
    let ri = 0;
    for (let i = 0; i < nRock * 4 && ri < nRock; i++) {
      const a = rand() * TAU, r = Math.sqrt(rand()) * PLAY_RADIUS * 1.6;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = this.heightAt(x, z), s = 0.7 + rand() * 2.6;
      const e = new THREE.Euler(rand() * 0.5, rand() * TAU, rand() * 0.5);
      quat.setFromEuler(e);
      m4.compose(v3.set(x, h + s * 0.32, z), quat, sc.set(s, s * 0.8, s));
      rock.setMatrixAt(ri, m4);
      rock.setColorAt(ri, col.copy(cRock).multiplyScalar(0.72 + rand() * 0.5));
      if (s > 1.5) {
        this.blockers.push({ x, y: h + s * 0.4, z, r: s * 0.72 });
        this.covers.push({ x, z, r: s, strength: 0.4 });
      }
      putShade(x, z, s * 0.95);
      ri++;
    }
    rock.count = ri;
    shade.count = sN;

    for (const m of [grass, bush, trunk, canopy, rock, shade]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.instanced = [grass, bush, trunk, canopy, rock, shade];
  }

  prewarmMaterials(ctx) {
    // Compile every permutation this system can produce before the first frame.
    return this.instanced.map((m) => m);
  }

  dispose() {
    for (const o of this.owned) { try { o.dispose(); } catch (e) { /* already gone */ } }
    this.owned.length = 0;
  }
}
