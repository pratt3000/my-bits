import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * ASSETS — the only bytes this game downloads.
 *
 * Two Thrixel models, both put through `gltf-transform optimize` first:
 *   cheetah  8.27 MB -> 411 KB   (sculpt_model, then the free reduce_triangles,
 *                                 then 4K PNG -> 1K webp)
 *   rifle      302 KB -> 208 KB  (create_model, 48 named parts intact)
 *
 * Everything else in the world is generated, so these are the whole payload.
 */
const MODELS = {
  cheetah: { url: '/models/cheetah-web.glb', scale: 2.1, up: 0 },
  rifle:   { url: '/models/rifle-web.glb',   scale: 1.0, up: 0 }
};

export class AssetSystem {
  static id = 'assets';
  static deps = [];

  async init(ctx) {
    this.ctx = ctx;
    this.models = {};
    this.failed = [];
    const loader = new GLTFLoader();
    const jobs = Object.entries(MODELS).map(([key, def]) =>
      loader.loadAsync(def.url).then((gltf) => {
        const root = gltf.scene;
        // Thrixel normalises every asset into roughly the same bounding box, so
        // a cheetah and a castle import the same size. Real scale is set here.
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());
        const k = def.scale / Math.max(size.x, size.y, size.z);
        root.scale.setScalar(k);
        root.position.sub(centre.multiplyScalar(k));
        const box2 = new THREE.Box3().setFromObject(root);
        root.position.y -= box2.min.y + def.up;
        root.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = true;
          o.receiveShadow = true;
          // The sculpt ships a metalness of 1 on a fur material, which renders
          // it near-black under a warm sun; a coat is a dielectric.
          const m = o.material;
          if (m && m.isMeshStandardMaterial) {
            m.metalness = Math.min(m.metalness ?? 0, 0.05);
            m.roughness = Math.max(m.roughness ?? 1, 0.62);
          }
        });
        const parts = [];
        root.traverse((o) => { if (o.isMesh) parts.push(o.name || '(unnamed)'); });
        this.models[key] = { root, parts, size: size.toArray() };
      }).catch((err) => {
        this.failed.push(key + ': ' + err);
        this.models[key] = null;
      })
    );
    await Promise.all(jobs);
    if (this.failed.length) console.warn('[assets]', this.failed.join(' | '));
  }

  /** A fresh instance sharing the loaded geometry and materials. */
  instance(key) {
    const m = this.models[key];
    if (!m) return null;
    return m.root.clone(true);
  }

  partNames(key) { return this.models[key]?.parts ?? []; }

  async prewarmMaterials() { return { ok: true }; }
}
