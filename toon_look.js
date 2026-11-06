/* TOON LOOK for any GLB, two styles (opts.style, default 'pupkins'):
   - 'pupkins': the Pupkins / Schiffy look as Last Pup Standing renders the Whale Hub assets (LPS src/render/toon.ts
     toonRamp + toonify, propsView.ts toonOf, worldLook.ts forest lights): 3 hard bands (110 / 190 / 255, deep shadow),
     colours + textures shown as painted (needs sRGB output: three r152+ default; r128: renderer.outputEncoding =
     THREE.sRGBEncoding), NO ink on props (LPS inks characters only: near-black #14100a; ask with ink: true).
   - 'pawty': the Schiffy Pawty look (Games/Web/schiffy-pawty-glb/index.html: GRAD ~1187, glbTexMat / artMat ~1404-1435,
     inkMat / inkify ~11493-11530, lights() ~1201): 4 lighter bands, purple ink (#3b2a45) on every prop, linear output
     (r128 without colour management; colours still show as authored).
   Both: MeshToonMaterial, textures (Tripo) and vertex colours kept; material names Gold* = gold + small emissive,
   Glow* = glows, Tint* = recolour via opts.tint. Ink = back-face shells pushed out in view space (same pixel width at any
   distance). Not included (game-only): vertex-colour bake (draw-call saver, same look), bloom / grade pass, rim light.

   Use (classic script after three.js + GLTFLoader):
     const TL = makePawtyLook(THREE);                    // or makePawtyLook(THREE, { style: 'pawty' })
     TL.lights(scene);                                   // optional: the style's light rig
     const obj = await TL.load('Set_windmill.glb');      // load + look in one call
     // or: TL.look(gltf.scene, { tint: { TintA: '#ff8fb1' }, ink: true, style: 'pawty' })
   ES-module three: import * as THREE from 'three'; then call makePawtyLook(THREE) (paste this file or load it as a script). */
function makePawtyLook(THREE, defaults = {}) {
  const STYLES = {
    pupkins: { ramp: [110, 190, 255], ink: false, inkColor: '#14100a', srgb: true,
      light: { sky: '#dff4ff', ground: '#5d7f3c', hemi: 1.15, sun: '#fff1d2', sunI: 2.6, dir: [.75, .8, .3], fill: 0 } },
    pawty: { ramp: [128, 184, 232, 255], ink: true, inkColor: '#3b2a45', srgb: false,
      light: { sky: '#ffffff', ground: '#88aa77', hemi: .56, sun: '#fff2df', sunI: .74, dir: [12, 26, 14], fill: .17, legacy: true } },
  };
  const STYLE0 = defaults.style || 'pupkins';
  const INKW = { pup: { k: .0034, max: .08, min: .1 }, prop: { k: .0024, max: .08, min: .3 }, decor: { k: .0019, max: .07, min: .42 } };
  // CM = three with colour management (r152+): colours stay as loaded. r128: pawty shows linear colours as sRGB hex
  // (the game's way), pupkins converts hex inputs to linear (it expects sRGB output).
  const CM = !!(THREE.ColorManagement && THREE.ColorManagement.enabled);
  const LEGACY = +THREE.REVISION < 155; /* light units: before r155 intensities had no pi; LPS (r186) numbers / pi */
  const ramps = {};
  const ramp = st => ramps[st] || (ramps[st] = (() => {
    const v = STYLES[st].ramp, d = new Uint8Array(v.length * 4); v.forEach((x, i) => d.set([x, x, x, 255], i * 4));
    const t = new THREE.DataTexture(d, v.length, 1, THREE.RGBAFormat); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t;
  })());
  const lin2srgb = v => v <= .0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - .055;
  // a hex / loaded colour as this style shows it
  const hexC = (h, st) => { const c = new THREE.Color(h); return STYLES[st].srgb && !CM ? c.convertSRGBToLinear() : c; };
  const glbC = (c, st) => CM || STYLES[st].srgb ? c.clone() : new THREE.Color(lin2srgb(c.r), lin2srgb(c.g), lin2srgb(c.b));
  const cache = new Map();

  // one toon material for a loaded GLB material (cached per source material + tint + style)
  function toonMat(src, tint, st = STYLE0) {
    const n = src.name || '', key = src.uuid + '|' + (tint || '') + '|' + st;
    if (cache.has(key)) return cache.get(key);
    const o = { gradientMap: ramp(st), name: n, vertexColors: !!src.vertexColors, side: src.side, transparent: src.transparent, opacity: src.opacity, depthWrite: src.depthWrite };
    if (src.map) {
      o.map = src.map; o.color = tint ? hexC(tint, st) : new THREE.Color(1, 1, 1);
      if (!CM) { const enc = STYLES[st].srgb ? THREE.sRGBEncoding : THREE.LinearEncoding; if (src.map.encoding !== enc) { src.map.encoding = enc; src.map.needsUpdate = true; } }
    } else o.color = tint ? hexC(tint, st) : glbC(src.color, st);
    if (src.alphaTest) o.alphaTest = src.alphaTest;
    const m = new THREE.MeshToonMaterial(o);
    if (/^Gold/.test(n) && !src.map) m.color.copy(hexC('#ffd04a', st));
    if (/^Gold/.test(n)) m.emissive = hexC('#3a2600', st);
    else if (/^Glow/.test(n)) { m.emissive = (src.map ? hexC('#ffe2a0', st) : m.color.clone()).multiplyScalar(.7); if (src.map) m.emissiveMap = src.map; }
    else if (src.emissive && src.emissive.getHex()) {
      m.emissive = glbC(src.emissive, st); m.emissiveIntensity = src.emissiveIntensity == null ? 1 : src.emissiveIntensity;
      if (src.emissiveMap) { m.emissiveMap = src.emissiveMap; if (!CM && src.map) src.emissiveMap.encoding = src.map.encoding; }
    }
    cache.set(key, m); return m;
  }

  const inkCache = {};
  function inkMat(o = INKW.prop, skin = false, color = STYLES[STYLE0].inkColor) {
    const key = (skin ? 's' : 'm') + (o.world ? 'w' + o.world : o.k + '/' + o.max) + color;
    if (inkCache[key]) return inkCache[key];
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), side: THREE.BackSide });
    if (skin && 'skinning' in m) m.skinning = true; /* r128 needs the flag, newer three finds skinning itself */
    m.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <skinning_vertex>', `#include <skinning_vertex>
        vec3 inkN = normalize(normal);
        #ifdef USE_SKINNING
          mat4 inkSkin = boneMatX * skinWeight.x + boneMatY * skinWeight.y + boneMatZ * skinWeight.z + boneMatW * skinWeight.w;
          inkN = (bindMatrixInverse * inkSkin * bindMatrix * vec4(inkN, 0.0)).xyz;
        #endif`).replace('#include <project_vertex>', `#include <project_vertex>
        { vec3 inkV = normalize(normalMatrix * inkN); mvPosition.xyz += inkV * ${o.world ? o.world.toFixed(4) : `min(-mvPosition.z * ${o.k.toFixed(5)}, ${o.max.toFixed(4)})`}; gl_Position = projectionMatrix * mvPosition; }`);
    };
    m.customProgramCacheKey = () => 'toonInk' + key;
    return inkCache[key] = m;
  }
  const FLAT = /^(Circle|Plane|Ring|Shape)/;
  const inkable = n => {
    const m = n.material;
    if (!n.isMesh || Array.isArray(m) || !m || n.userData.ink || n.userData.noInk || n.userData.isInk) return false;
    if (m.isMeshBasicMaterial || m.transparent || !m.depthWrite || m.opacity < 1 || m.side === THREE.BackSide) return false;
    return !FLAT.test(n.geometry.type) && !(n.geometry.parameters && n.geometry.parameters.openEnded);
  };
  const size = n => { const g = n.geometry; if (!g.boundingSphere) g.computeBoundingSphere(); return g.boundingSphere.radius * n.matrixWorld.getMaxScaleOnAxis(); };
  // ink shells on every opaque, front-sided mesh at least o.min big (world radius); returns how many
  function inkify(obj, o = INKW.prop, color = STYLES[STYLE0].inkColor) {
    obj.updateMatrixWorld(true);
    const list = [];
    obj.traverse(n => { if (!inkable(n)) return; n.userData.ink = 1; if (n.isSkinnedMesh ? !/face|decal|eye/i.test(n.name) : size(n) >= (o.min == null ? .3 : o.min)) list.push(n); });
    for (const n of list) {
      if (!n.geometry.attributes.normal) n.geometry.computeVertexNormals();
      const s = new (n.isSkinnedMesh ? THREE.SkinnedMesh : THREE.Mesh)(n.geometry, inkMat(o, !!n.isSkinnedMesh, color));
      s.userData.isInk = true; s.castShadow = s.receiveShadow = false;
      if (n.isSkinnedMesh) { s.bind(n.skeleton, n.bindMatrix); s.bindMode = n.bindMode; s.frustumCulled = false; s.position.copy(n.position); s.quaternion.copy(n.quaternion); s.scale.copy(n.scale); n.parent.add(s); }
      else n.add(s);
    }
    return list.length;
  }

  // opts: style = 'pupkins' | 'pawty', tint = { TintA: '#hex', ... } (by material-name prefix),
  // ink = style default | true | false | INKW-style {k, max, min} (pixel-constant) | {world: metres, min} (fixed width,
  // e.g. the Pawty board camera at ~22 m: {world: .045} = the in-game line on a close-up), inkColor = '#hex', shadows = true
  function look(obj, opts = {}) {
    const st = opts.style || STYLE0, S = STYLES[st], tint = opts.tint || {}, sh = opts.shadows !== false;
    obj.traverse(n => {
      if (!n.isMesh || n.userData.isInk) return;
      if (!n.geometry.attributes.normal) n.geometry.computeVertexNormals();
      const one = m => { const nm = m.name || '', t = Object.keys(tint).find(k => nm.startsWith(k)); return toonMat(m, t ? tint[t] : '', st); };
      n.material = Array.isArray(n.material) ? n.material.map(one) : one(n.material);
      n.castShadow = n.receiveShadow = sh;
    });
    const ink = opts.ink === undefined ? S.ink : opts.ink;
    if (ink) inkify(obj, typeof ink === 'object' ? ink : INKW.prop, opts.inkColor || S.inkColor);
    return obj;
  }

  // the style's light rig: pupkins = LPS forest (hemi + warm sun), pawty = the minigame lights() + cool fill
  function lights(scene, style = STYLE0) {
    const L = STYLES[style].light, k = L.legacy ? (LEGACY ? 1 : Math.PI) : (LEGACY ? 1 / Math.PI : 1); /* pawty numbers are r128 units, pupkins r186 */
    const c = h => hexC(h, style);
    scene.add(new THREE.HemisphereLight(c(L.sky), c(L.ground), L.hemi * k));
    if (L.fill) { const f = new THREE.DirectionalLight(c('#bcd2ff'), L.fill * k); f.position.set(-14, 9, -12); scene.add(f); }
    const d = new THREE.DirectionalLight(c(L.sun), L.sunI * k);
    d.position.set(...L.dir).normalize().multiplyScalar(30); scene.add(d);
    return d;
  }

  // load a GLB and apply the look; resolves to the scene root
  function load(url, opts = {}) {
    const L = new THREE.GLTFLoader();
    if (typeof MeshoptDecoder !== 'undefined' && L.setMeshoptDecoder) L.setMeshoptDecoder(MeshoptDecoder);
    return new Promise((res, rej) => L.load(url, g => res(look(g.scene, opts)), undefined, rej));
  }

  return { look, load, lights, toonMat, inkify, inkMat, ramp, STYLES, INKW };
}
if (typeof window !== 'undefined') window.makePawtyLook = makePawtyLook;
if (typeof module !== 'undefined' && module.exports) module.exports = makePawtyLook;
