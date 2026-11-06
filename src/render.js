// three.js side: GLB parsing, shared thumbnail renderer, 3D viewer.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const loader = new GLTFLoader();
const draco = new DRACOLoader();
draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/');
loader.setDRACOLoader(draco);
loader.setMeshoptDecoder(MeshoptDecoder);
const TL = window.makePawtyLook ? window.makePawtyLook(THREE) : null;

export const parse = buf => loader.parseAsync(buf, '');

function dispose(obj) {
  obj.traverse(n => {
    if (n.geometry) n.geometry.dispose();
    const ms = Array.isArray(n.material) ? n.material : n.material ? [n.material] : [];
    for (const m of ms) { for (const v of Object.values(m)) if (v && v.isTexture) v.dispose(); m.dispose(); }
  });
}

function stats(root) {
  let tris = 0, meshes = 0; const mats = new Set();
  root.traverse(n => {
    if (!n.isMesh || n.userData.isInk) return;
    meshes++;
    const g = n.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    (Array.isArray(n.material) ? n.material : [n.material]).forEach(m => mats.add(m));
  });
  return { tris: Math.round(tris), meshes, materials: mats.size };
}

// Fit camera to object; returns the bounding sphere radius
function frame(cam, obj, controls) {
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return 1;
  const s = box.getBoundingSphere(new THREE.Sphere());
  const r = s.radius || 1, d = r / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2)) * 1.15;
  const dir = new THREE.Vector3(0.9, 0.62, 1.25).normalize();
  cam.position.copy(s.center).addScaledVector(dir, d);
  cam.near = d / 100; cam.far = d * 100; cam.updateProjectionMatrix();
  cam.lookAt(s.center);
  if (controls) { controls.target.copy(s.center); controls.update(); }
  return r;
}

function plainLights(scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a6a, 2.2));
  const d = new THREE.DirectionalLight(0xffffff, 2.4); d.position.set(3, 5, 4); scene.add(d);
}

// ---------- thumbnails (one renderer for all cards) ----------
let tr = null;
function thumbRig() {
  if (tr) return tr;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(256, 256, false);
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
  if (TL) TL.lights(scene); else plainLights(scene);
  return tr = { renderer, scene, cam };
}

// buf -> webp Blob
export async function thumbnail(buf) {
  const g = await parse(buf);
  const { renderer, scene, cam } = thumbRig();
  const obj = g.scene;
  if (TL) TL.look(obj, { shadows: false });
  scene.add(obj);
  frame(cam, obj);
  renderer.render(scene, cam);
  const blob = await new Promise(res => renderer.domElement.toBlob(res, 'image/webp', 0.85));
  scene.remove(obj); dispose(obj);
  return blob;
}

// ---------- viewer ----------
export class Viewer {
  constructor(wrap) {
    this.wrap = wrap;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    wrap.appendChild(this.renderer.domElement);
    this.cam = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
    this.controls = new OrbitControls(this.cam, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.clock = new THREE.Clock();
    this.mixer = null; this.gltf = null; this.obj = null; this.running = false;
    new ResizeObserver(() => this.resize()).observe(wrap);
  }
  resize() {
    const w = this.wrap.clientWidth, h = this.wrap.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false); this.cam.aspect = w / h; this.cam.updateProjectionMatrix();
  }
  // look: 'pupkins' | 'plain'. Returns stats + animation names.
  show(gltf, look, keepCam = false) {
    this.clear();
    this.gltf = gltf;
    this.build(look);
    if (!keepCam) frame(this.cam, this.obj, this.controls);
    this.start();
    return { ...stats(this.obj), animations: gltf.animations.map(a => a.name || 'clip') };
  }
  build(look) {
    const scene = this.scene = new THREE.Scene();
    // the toon look swaps materials in place, so plain view re-parses from the original buffer (app keeps it)
    this.obj = this.gltf.scene;
    if (look === 'pupkins' && TL) { TL.lights(scene); TL.look(this.obj); } else plainLights(scene);
    scene.add(this.obj);
    this.mixer = this.gltf.animations.length ? new THREE.AnimationMixer(this.obj) : null;
  }
  play(i) {
    if (!this.mixer) return;
    this.mixer.stopAllAction();
    if (i >= 0 && this.gltf.animations[i]) this.mixer.clipAction(this.gltf.animations[i]).play();
  }
  start() {
    if (this.running) return;
    this.running = true; this.clock.getDelta();
    const tick = () => {
      if (!this.running) return;
      const dt = this.clock.getDelta();
      if (this.mixer) this.mixer.update(dt);
      this.controls.update();
      this.renderer.render(this.scene, this.cam);
      requestAnimationFrame(tick);
    };
    this.resize(); tick();
  }
  clear() {
    this.running = false;
    if (this.obj) { this.scene.remove(this.obj); dispose(this.obj); }
    this.obj = null; this.gltf = null; this.mixer = null;
  }
}
