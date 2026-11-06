// GLB Library: wires the UI to Drive (or ?mock) and the three.js side.
import * as drive from './src/drive.js';
import * as store from './src/store.js';
import { thumbnail, parse, Viewer } from './src/render.js';
import { THUMB_MAX_BYTES } from './config.js';

const MOCK = new URLSearchParams(location.search).has('mock');
const $ = id => document.getElementById(id);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const fmtSize = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';

let files = [], shown = [], folderId = null, folderName = '', treeSel = '';

// ---------- data source (Drive or mock) ----------
const source = MOCK ? {
  ready: () => true,
  list: async () => ({ name: 'Mock library', files: await (await fetch('mock/files.json')).json() }),
  bytes: async id => (await fetch(`mock/glb/${id}.glb`)).arrayBuffer(),
} : {
  ready: drive.signedIn,
  list: id => drive.listTree(id, (n, left) => status(`Listing... ${n} GLBs found, ${left} folders to go`)),
  bytes: drive.fetchFile,
};

// ---------- status line ----------
function status(msg, kind = '', action = null) {
  const s = $('status');
  s.hidden = !msg; s.className = 'status ' + kind; s.textContent = msg || '';
  if (action) { const b = el('button', '', action.label); b.style.marginLeft = '10px'; b.onclick = action.fn; s.appendChild(b); }
}
function fail(e) {
  console.error(e);
  if (e instanceof drive.NeedSignIn) { authUI(); status(e.message, 'err', { label: 'Sign in', fn: doSignIn }); }
  else status(e.message || String(e), 'err');
}

// ---------- auth ----------
async function authUI() {
  const on = MOCK || drive.signedIn();
  $('signin').hidden = on; $('signout').hidden = !on || MOCK;
  $('who').textContent = MOCK ? 'mock mode (no Google)' : '';
  if (on && !MOCK) drive.whoAmI().then(u => { $('who').textContent = u.emailAddress; }).catch(() => {});
}
async function doSignIn() {
  try { await drive.signIn(); status(''); await authUI(); if (folderId) openFolder(folderId); }
  catch (e) { fail(e); }
}
$('signin').onclick = doSignIn;
$('signout').onclick = () => { drive.signOut(); authUI(); files = []; render(); status('Signed out.'); };

// ---------- folder ----------
async function openFolder(id, refresh = false) {
  folderId = id;
  const key = 'list:' + (MOCK ? 'mock' : id);
  if (!refresh && !MOCK) {
    const c = await store.get(key);
    if (c) { setFiles(c); status(`Listing cached ${new Date(c.at).toLocaleString()}. Refresh shows new uploads.`); return; }
  }
  if (!source.ready()) { status('Sign in with Google to open this folder.', '', { label: 'Sign in', fn: doSignIn }); return; }
  try {
    status('Listing...');
    const r = await source.list(id);
    const c = { name: r.name, files: r.files, at: Date.now() };
    await store.set(key, c);
    setFiles(c); status('');
  } catch (e) { fail(e); }
}
function setFiles(c) {
  folderName = c.name;
  files = c.files.slice().sort((a, b) => a.path.localeCompare(b.path) || a.name.localeCompare(b.name));
  buildTree(); render();
}
$('folderForm').onsubmit = ev => {
  ev.preventDefault();
  const id = drive.parseFolderId($('folderInput').value);
  if (!id) return status('That does not look like a Drive folder link.', 'err');
  store.lsSet('folder', $('folderInput').value.trim());
  treeSel = ''; openFolder(id);
};
$('refresh').onclick = () => { if (folderId || MOCK) openFolder(folderId || 'mock', true); };

// ---------- filter + tree ----------
const wip = f => /(^|\/)_WIP(\/|$)/i.test(f.path);
function filtered() {
  const words = $('search').value.toLowerCase().split(/\s+/).filter(Boolean);
  const hide = $('hideWip').checked;
  return files.filter(f => {
    if (hide && wip(f)) return false;
    if (treeSel && !(f.path === treeSel || f.path.startsWith(treeSel + '/'))) return false;
    const hay = (f.path + '/' + f.name).toLowerCase();
    return words.every(w => hay.includes(w));
  });
}
function buildTree() {
  const counts = new Map();
  for (const f of files) {
    const parts = f.path ? f.path.split('/') : [];
    for (let i = 1; i <= parts.length; i++) { const p = parts.slice(0, i).join('/'); counts.set(p, (counts.get(p) || 0) + 1); }
  }
  const t = $('tree'); t.textContent = '';
  const row = (p, label, depth, n) => {
    const d = el('div', p === treeSel ? 'on' : ''); d.style.paddingLeft = 6 + depth * 12 + 'px';
    d.append(label); d.appendChild(el('span', 'n', n)); d.title = p || folderName;
    d.onclick = () => { treeSel = p; buildTree(); render(); }; t.appendChild(d);
  };
  row('', folderName || 'All', 0, files.length);
  [...counts.keys()].sort().forEach(p => row(p, p.split('/').pop(), p.split('/').length, counts.get(p)));
}
$('search').oninput = () => render();
$('hideWip').onchange = () => { store.lsSet('hideWip', $('hideWip').checked ? '1' : ''); render(); };

// ---------- grid ----------
const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { io.unobserve(e.target); queueThumb(e.target); } }), { root: $('grid'), rootMargin: '400px' });
function render() {
  const g = $('grid'); g.textContent = '';
  shown = filtered();
  $('count').textContent = files.length ? `${shown.length} / ${files.length}` : '';
  if (!files.length) {
    g.appendChild(el('div', 'empty', MOCK ? 'Loading mock data...' : drive.signedIn() || !drive.hasClientId()
      ? (drive.hasClientId() ? 'Paste a Drive folder link above.' : 'Setup needed: add the OAuth client ID to config.js (docs/SETUP_GOOGLE.md).')
      : 'Sign in with Google, then paste a Drive folder link.'));
    return;
  }
  if (!shown.length) { g.appendChild(el('div', 'empty', 'Nothing matches.')); return; }
  let grp = null, cards = null;
  shown.forEach((f, i) => {
    if (!grp || grp.dataset.path !== f.path) {
      grp = el('div', 'grp'); grp.dataset.path = f.path;
      grp.appendChild(el('h3', '', f.path || folderName || '/'));
      cards = el('div', 'cards'); grp.appendChild(cards); g.appendChild(grp);
    }
    const c = el('div', 'card'); c.dataset.i = i;
    const th = el('div', 'th'); c.appendChild(th);
    if (wip(f)) th.appendChild(el('span', 'wip', 'WIP'));
    const m = el('div', 'meta'); m.appendChild(el('div', 'nm', f.name.replace(/\.glb$/i, ''))); m.appendChild(el('div', 'sz', fmtSize(f.size)));
    c.title = f.path + '/' + f.name; c.appendChild(m);
    c.onclick = () => openViewer(i);
    c._file = f;
    cards.appendChild(c); io.observe(c);
  });
}

// ---------- thumbnails: lazy, 2 at a time, IndexedDB cache ----------
const tq = []; let tActive = 0;
const thumbKey = f => 'th:' + f.id + '|' + f.modifiedTime;
async function queueThumb(card) {
  const f = card._file, th = card.querySelector('.th');
  const hit = await store.get(thumbKey(f));
  if (hit) return putImg(th, hit);
  if (f.size > THUMB_MAX_BYTES) {
    const b = el('button', '', 'render (' + fmtSize(f.size) + ')');
    b.onclick = ev => { ev.stopPropagation(); b.remove(); tq.unshift(card); pumpThumbs(); };
    th.appendChild(b); return;
  }
  tq.push(card); pumpThumbs();
}
function putImg(th, blob) { const img = new Image(); img.src = URL.createObjectURL(blob); img.alt = ''; th.prepend(img); }
function pumpThumbs() {
  while (tActive < 2 && tq.length) {
    const card = tq.shift();
    if (!card.isConnected) continue;
    tActive++;
    const f = card._file, th = card.querySelector('.th');
    const ph = el('span', '', '...'); th.appendChild(ph);
    source.bytes(f.id).then(thumbnail).then(blob => { store.set(thumbKey(f), blob); putImg(th, blob); })
      .catch(e => { ph.textContent = e instanceof drive.NeedSignIn ? 'signed out' : 'no preview'; console.warn(f.name, e); if (e instanceof drive.NeedSignIn) fail(e); })
      .finally(() => { if (ph.textContent === '...') ph.remove(); tActive--; pumpThumbs(); });
  }
}

// ---------- viewer ----------
let viewer = null, vIdx = -1, vBuf = null, vSeq = 0;
async function openViewer(i) {
  const f = shown[i]; if (!f) return;
  vIdx = i; const seq = ++vSeq;
  $('viewer').hidden = false;
  if (!viewer) viewer = new Viewer($('vCanvasWrap'));
  $('vName').textContent = f.name; $('vPath').textContent = f.path || '/';
  $('vDrive').hidden = MOCK; $('vDrive').href = `https://drive.google.com/file/d/${f.id}/view`;
  $('vStats').textContent = ''; $('vAnimWrap').hidden = true; $('vLoading').hidden = false; $('vLoading').textContent = 'Loading ' + fmtSize(f.size) + '...';
  viewer.clear();
  try {
    const buf = await source.bytes(f.id);
    if (seq !== vSeq) return;
    vBuf = buf; await showBuf(false);
    $('vLoading').hidden = true;
  } catch (e) { if (seq === vSeq) $('vLoading').textContent = 'Could not load: ' + (e.message || e); if (e instanceof drive.NeedSignIn) fail(e); }
}
async function showBuf(keepCam) {
  const f = shown[vIdx], gltf = await parse(vBuf.slice(0));
  const s = viewer.show(gltf, $('vLook').value, keepCam);
  const rows = [['Triangles', s.tris.toLocaleString()], ['Meshes', s.meshes], ['Materials', s.materials], ['Animations', s.animations.length], ['Size', fmtSize(f.size)], ['Modified', new Date(f.modifiedTime).toLocaleDateString()]];
  const t = $('vStats'); t.textContent = '';
  rows.forEach(([k, v]) => { const tr = el('tr'); tr.appendChild(el('td', '', k)); tr.appendChild(el('td', '', v)); t.appendChild(tr); });
  const a = $('vAnim'); a.textContent = '';
  $('vAnimWrap').hidden = !s.animations.length;
  if (s.animations.length) {
    a.appendChild(new Option('(none)', -1));
    s.animations.forEach((n, i) => a.appendChild(new Option(n, i)));
    a.value = 0; viewer.play(0);
  }
}
function closeViewer() { $('viewer').hidden = true; vSeq++; if (viewer) viewer.clear(); vBuf = null; }
$('vClose').onclick = closeViewer;
$('viewer').onclick = e => { if (e.target === $('viewer')) closeViewer(); };
$('vPrev').onclick = () => openViewer((vIdx - 1 + shown.length) % shown.length);
$('vNext').onclick = () => openViewer((vIdx + 1) % shown.length);
$('vLook').onchange = () => { store.lsSet('look', $('vLook').value); if (vBuf) showBuf(true); };
$('vAnim').onchange = () => viewer.play(+$('vAnim').value);
$('vDownload').onclick = () => {
  if (!vBuf) return;
  const a = el('a'); a.href = URL.createObjectURL(new Blob([vBuf], { type: 'model/gltf-binary' })); a.download = shown[vIdx].name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};
addEventListener('keydown', e => {
  if ($('viewer').hidden) return;
  if (e.key === 'Escape') closeViewer();
  else if (e.key === 'ArrowLeft') $('vPrev').click();
  else if (e.key === 'ArrowRight') $('vNext').click();
});

// ---------- start ----------
$('hideWip').checked = store.lsGet('hideWip') === '1';
$('vLook').value = store.lsGet('look') || 'pupkins';
authUI();
if (MOCK) { $('folderForm').hidden = true; openFolder('mock'); }
else {
  const last = store.lsGet('folder');
  if (last) { $('folderInput').value = last; const id = drive.parseFolderId(last); if (id) openFolder(id); }
  render();
  if (!drive.hasClientId()) status('Setup needed: add the OAuth client ID to config.js (see docs/SETUP_GOOGLE.md).', 'err');
}
