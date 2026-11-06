// GLB Library: wires the UI to Drive (or ?mock) and the three.js side.
import * as drive from './src/drive.js';
import * as store from './src/store.js';
import { thumbnail, parse, Viewer } from './src/render.js';
import { THUMB_MAX_BYTES } from './config.js';

const MOCK = new URLSearchParams(location.search).has('mock');
const $ = id => document.getElementById(id);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const fmtSize = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
const fmtTris = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
const NEW_MS = 7 * 864e5;
const FAV = '★ Favourites';

let files = [], shown = [], folderId = null, folderName = '', treeSel = '';
let pendingFile = null; // from a shared #f= link

// per-viewer settings (localStorage)
const lsJson = (k, d) => { try { return JSON.parse(store.lsGet(k)) ?? d; } catch { return d; } };
const favs = new Set(lsJson('favs', []));
const saveFavs = () => store.lsSet('favs', JSON.stringify([...favs]));
let hidden = new Set();
const hiddenKey = () => 'hidden:' + (MOCK ? 'mock' : folderId);
const saveHidden = () => store.lsSet(hiddenKey(), JSON.stringify([...hidden]));

// ---------- data source (Drive or mock) ----------
const source = MOCK ? {
  ready: () => true,
  list: async () => ({ name: 'Mock library', files: await (await fetch('mock/files.json')).json() }),
  bytes: async (id, onProgress, total) => drive.readAll(await fetch(`mock/glb/${id}.glb`), total, onProgress),
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
let toastT = 0;
function toast(msg) { status(msg); clearTimeout(toastT); toastT = setTimeout(() => { if ($('status').textContent === msg) status(''); }, 2500); }

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
  hidden = new Set(lsJson(hiddenKey(), []));
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
  if (pendingFile) {
    const id = pendingFile; pendingFile = null;
    let i = shown.findIndex(f => f.id === id);
    if (i < 0 && files.some(f => f.id === id)) { treeSel = ''; $('search').value = ''; hidden.delete([...hidden].find(h => files.find(f => f.id === id).path.startsWith(h)) || ''); buildTree(); render(); i = shown.findIndex(f => f.id === id); }
    if (i >= 0) openViewer(i); else status('That shared file is not in this folder (or not shared with you).', 'err');
  }
}
$('folderForm').onsubmit = ev => {
  ev.preventDefault();
  const id = drive.parseFolderId($('folderInput').value);
  if (!id) return status('That does not look like a Drive folder link.', 'err');
  store.lsSet('folder', $('folderInput').value.trim());
  treeSel = ''; openFolder(id);
};
$('refresh').onclick = () => { if (folderId || MOCK) openFolder(folderId || 'mock', true); };

// ---------- filter, sort, tree ----------
const wip = f => /(^|\/)_WIP(\/|$)/i.test(f.path);
const isNew = f => Date.now() - Date.parse(f.modifiedTime) < NEW_MS;
const under = (path, p) => path === p || path.startsWith(p + '/');
const isHidden = path => [...hidden].some(h => under(path, h));
function filtered() {
  const words = $('search').value.toLowerCase().split(/\s+/).filter(Boolean);
  const hideW = $('hideWip').checked;
  const list = files.filter(f => {
    if (treeSel === FAV) { if (!favs.has(f.id)) return false; }
    else {
      if (treeSel && !under(f.path, treeSel)) return false;
      if (isHidden(f.path) && !(treeSel && isHidden(treeSel) && under(f.path, treeSel))) return false;
    }
    if (hideW && wip(f)) return false;
    const hay = (f.path + '/' + f.name).toLowerCase();
    return words.every(w => hay.includes(w));
  });
  const s = $('sort').value;
  if (s === 'new') list.sort((a, b) => Date.parse(b.modifiedTime) - Date.parse(a.modifiedTime));
  else if (s === 'big') list.sort((a, b) => b.size - a.size);
  else if (s === 'small') list.sort((a, b) => a.size - b.size);
  return list;
}
function buildTree() {
  const counts = new Map();
  for (const f of files) {
    const parts = f.path ? f.path.split('/') : [];
    for (let i = 1; i <= parts.length; i++) { const p = parts.slice(0, i).join('/'); counts.set(p, (counts.get(p) || 0) + 1); }
  }
  const t = $('tree'); t.textContent = '';
  const row = (p, label, depth, n, canHide) => {
    const off = canHide && hidden.has(p);
    const d = el('div', (p === treeSel ? 'on ' : '') + (off ? 'off' : '')); d.style.paddingLeft = 6 + depth * 12 + 'px';
    d.appendChild(el('span', 'lbl', label)); d.appendChild(el('span', 'n', n)); d.title = p || folderName;
    d.onclick = () => { treeSel = p; buildTree(); render(); };
    if (canHide) {
      const b = el('button', 'hide', off ? 'show' : 'hide');
      b.title = off ? 'Show this folder in All' : 'Hide this folder from All (still opens when clicked)';
      b.onclick = ev => { ev.stopPropagation(); off ? hidden.delete(p) : hidden.add(p); saveHidden(); buildTree(); render(); };
      d.appendChild(b);
    }
    t.appendChild(d);
  };
  row('', folderName || 'All', 0, files.length, false);
  row(FAV, FAV, 0, files.filter(f => favs.has(f.id)).length, false);
  [...counts.keys()].sort().forEach(p => {
    const parent = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
    if (parent && isHidden(parent)) return; // collapse inside hidden folders
    row(p, p.split('/').pop(), p.split('/').length, counts.get(p), true);
  });
}
$('search').oninput = () => render();
$('hideWip').onchange = () => { store.lsSet('hideWip', $('hideWip').checked ? '1' : ''); render(); };
$('sort').onchange = () => { store.lsSet('sort', $('sort').value); render(); };
$('zoom').oninput = () => { document.documentElement.style.setProperty('--cardw', $('zoom').value + 'px'); store.lsSet('zoom', $('zoom').value); };

// ---------- grid ----------
const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { io.unobserve(e.target); queueThumb(e.target); } }), { root: $('grid'), rootMargin: '400px' });
function render() {
  const g = $('grid'); g.textContent = '';
  tq.length = 0;
  shown = filtered();
  $('count').textContent = files.length ? `${shown.length} / ${files.length}` : '';
  if (!files.length) {
    g.appendChild(el('div', 'empty', MOCK ? 'Loading mock data...' : drive.signedIn() || !drive.hasClientId()
      ? (drive.hasClientId() ? 'Paste a Drive folder link above.' : 'Setup needed: add the OAuth client ID to config.js (docs/SETUP_GOOGLE.md).')
      : 'Sign in with Google, then paste a Drive folder link.'));
    selUI(); return;
  }
  if (!shown.length) { g.appendChild(el('div', 'empty', treeSel === FAV ? 'No favourites yet: click the star on a card.' : 'Nothing matches.')); selUI(); return; }
  const flat = $('sort').value !== 'name' || treeSel === FAV;
  const label = { new: 'Newest first', big: 'Biggest first', small: 'Smallest first' }[$('sort').value] || FAV;
  let grp = null, cards = null;
  shown.forEach((f, i) => {
    const key = flat ? '*' : f.path;
    if (!grp || grp.dataset.path !== key) {
      grp = el('div', 'grp'); grp.dataset.path = key;
      grp.appendChild(el('h3', '', flat ? label : f.path || folderName || '/'));
      cards = el('div', 'cards'); grp.appendChild(cards); g.appendChild(grp);
    }
    cards.appendChild(card(f, i, flat));
  });
  selUI();
}
function card(f, i, showPath) {
  const c = el('div', 'card'); c.tabIndex = 0; c._file = f; c._i = i;
  const th = el('div', 'th'); c.appendChild(th);
  const badges = el('div', 'badges'); th.appendChild(badges);
  if (isNew(f)) badges.appendChild(el('span', 'new', 'NEW'));
  if (wip(f)) badges.appendChild(el('span', 'wip', 'WIP'));
  const star = el('button', 'star' + (favs.has(f.id) ? ' on' : ''), favs.has(f.id) ? '★' : '☆');
  star.title = 'Favourite'; star.onclick = ev => { ev.stopPropagation(); toggleFav(f.id); };
  th.appendChild(star);
  const m = el('div', 'meta');
  m.appendChild(el('div', 'nm', f.name.replace(/\.glb$/i, '')));
  if (showPath) m.appendChild(el('div', 'pth', f.path || '/'));
  const sz = el('div', 'sz', fmtSize(f.size)); m.appendChild(sz);
  c.title = f.path + '/' + f.name; c.appendChild(m);
  const pick = el('input', 'pick'); pick.type = 'checkbox'; pick.checked = picked.has(f.id); pick.title = 'Select';
  if (pick.checked) c.classList.add('sel');
  pick.onclick = ev => { ev.stopPropagation(); togglePick(i, ev.shiftKey); };
  th.appendChild(pick);
  c.onclick = ev => {
    if (ev.ctrlKey || ev.metaKey || ev.shiftKey || picked.size) togglePick(i, ev.shiftKey);
    else openViewer(i);
  };
  store.get(metaKey(f)).then(mt => { if (mt) tagCard(sz, f, mt); });
  io.observe(c);
  return c;
}
function tagCard(sz, f, mt) { sz.textContent = `${fmtSize(f.size)} · ${fmtTris(mt.tris)} tris${mt.anims ? ' · anim' : ''}`; }
function toggleFav(id) {
  favs.has(id) ? favs.delete(id) : favs.add(id); saveFavs();
  document.querySelectorAll('.card').forEach(c => { if (c._file.id === id) { const s = c.querySelector('.star'); s.classList.toggle('on', favs.has(id)); s.textContent = favs.has(id) ? '★' : '☆'; } });
  if (!$('viewer').hidden && shown[vIdx]?.id === id) vStarUI();
  buildTree(); if (treeSel === FAV) render();
}

// keyboard in the grid: arrows move, Enter opens, Space selects
$('grid').addEventListener('keydown', e => {
  const c = e.target.closest?.('.card'); if (!c) return;
  const all = [...document.querySelectorAll('.card')], idx = all.indexOf(c);
  let to = null;
  if (e.key === 'ArrowRight') to = all[idx + 1];
  else if (e.key === 'ArrowLeft') to = all[idx - 1];
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const r = c.getBoundingClientRect(), down = e.key === 'ArrowDown';
    const cand = all.filter(o => { const q = o.getBoundingClientRect(); return down ? q.top > r.top + 5 : q.bottom < r.bottom - 5; });
    const rowY = down ? Math.min(...cand.map(o => o.getBoundingClientRect().top)) : Math.max(...cand.map(o => o.getBoundingClientRect().top));
    const row = cand.filter(o => Math.abs(o.getBoundingClientRect().top - rowY) < 5);
    to = row.sort((a, b) => Math.abs(a.getBoundingClientRect().left - r.left) - Math.abs(b.getBoundingClientRect().left - r.left))[0];
  } else if (e.key === 'Enter') { openViewer(c._i); e.preventDefault(); return; }
  else if (e.key === ' ') { togglePick(c._i, e.shiftKey); e.preventDefault(); return; }
  else return;
  e.preventDefault();
  if (to) { to.focus(); to.scrollIntoView({ block: 'nearest' }); }
});

// ---------- multi-select + zip download ----------
const picked = new Map(); let lastPick = -1;
function togglePick(i, range) {
  if (range && lastPick >= 0 && shown[lastPick]) {
    for (let k = Math.min(lastPick, i); k <= Math.max(lastPick, i); k++) picked.set(shown[k].id, shown[k]);
  } else if (picked.has(shown[i].id)) picked.delete(shown[i].id);
  else picked.set(shown[i].id, shown[i]);
  lastPick = i; syncPicks();
}
function syncPicks() {
  document.querySelectorAll('.card').forEach(c => {
    const on = picked.has(c._file.id); c.classList.toggle('sel', on); c.querySelector('.pick').checked = on;
  });
  selUI();
}
function selUI() {
  const n = picked.size, bytes = [...picked.values()].reduce((s, f) => s + f.size, 0);
  $('selbar').hidden = !n; $('grid').classList.toggle('picking', !!n);
  $('selCount').textContent = `${n} selected (${fmtSize(bytes)})`;
  $('selDownload').textContent = n === 1 ? 'Download' : `Download ${n} as zip`;
}
$('selAll').onclick = () => { shown.forEach(f => picked.set(f.id, f)); syncPicks(); };
$('selClear').onclick = () => { picked.clear(); lastPick = -1; syncPicks(); };
function saveBlob(blob, name) {
  const a = el('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
$('selDownload').onclick = async () => {
  const list = [...picked.values()], total = list.reduce((s, f) => s + f.size, 0), n = list.length;
  if (total > 1.5 * 1024 ** 3 && !confirm(`That is ${fmtSize(total)}. Browsers can run out of memory above ~2 GB. Continue?`)) return;
  const btn = $('selDownload'); btn.disabled = true;
  try {
    if (n === 1) { saveBlob(new Blob([await source.bytes(list[0].id)]), list[0].name); return; }
    const { zipSync } = await import('https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js');
    const entries = {}; let done = 0, got = 0;
    const next = async () => {
      while (list.length) {
        const f = list.shift();
        let p = (f.path ? f.path + '/' : '') + f.name;
        if (entries[p]) p = p.replace(/\.glb$/i, `_${f.id.slice(0, 6)}.glb`);
        entries[p] = [new Uint8Array(await source.bytes(f.id)), { level: 0 }];
        done++; got += f.size; status(`Downloading ${done}/${n} (${fmtSize(got)} of ${fmtSize(total)})...`);
      }
    };
    await Promise.all([next(), next(), next()]);
    status('Zipping...');
    saveBlob(new Blob([zipSync(entries)], { type: 'application/zip' }), `glb-${done}-files.zip`);
    status('');
  } catch (e) { fail(e); } finally { btn.disabled = false; }
};

// ---------- thumbnails: lazy, 2 at a time, IndexedDB cache ----------
const tq = []; let tActive = 0;
const thumbKey = f => 'th:' + f.id + '|' + f.modifiedTime;
const metaKey = f => 'mt:' + f.id + '|' + f.modifiedTime;
async function queueThumb(c) {
  const f = c._file, th = c.querySelector('.th');
  const hit = await store.get(thumbKey(f));
  if (hit) return putImg(th, hit);
  if (f.size > THUMB_MAX_BYTES) {
    const b = el('button', 'big', 'render (' + fmtSize(f.size) + ')');
    b.onclick = ev => { ev.stopPropagation(); b.remove(); tq.unshift(c); pumpThumbs(); };
    th.appendChild(b); return;
  }
  tq.push(c); pumpThumbs();
}
function putImg(th, blob) { const img = new Image(); img.src = URL.createObjectURL(blob); img.alt = ''; th.prepend(img); }
function pumpThumbs() {
  while (tActive < 2 && tq.length && $('viewer').hidden) { // viewer open = it gets all the bandwidth
    const c = tq.shift();
    if (!c.isConnected) continue;
    tActive++;
    const f = c._file, th = c.querySelector('.th');
    const ph = el('span', 'ph', '...'); th.appendChild(ph);
    source.bytes(f.id).then(thumbnail).then(r => {
      store.set(thumbKey(f), r.blob); store.set(metaKey(f), { tris: r.tris, anims: r.anims });
      putImg(th, r.blob); tagCard(c.querySelector('.sz'), f, r);
    })
      .catch(e => { ph.textContent = e instanceof drive.NeedSignIn ? 'signed out' : 'no preview'; console.warn(f.name, e); if (e instanceof drive.NeedSignIn) fail(e); })
      .finally(() => { if (ph.textContent === '...') ph.remove(); tActive--; pumpThumbs(); });
  }
}

// ---------- viewer ----------
let viewer = null, vIdx = -1, vBuf = null, vSeq = 0;
// last opened files kept in memory (up to ~300 MB) so prev/next back is instant
const recent = new Map(); let recentBytes = 0;
function remember(id, buf) {
  if (recent.has(id)) return;
  recent.set(id, buf); recentBytes += buf.byteLength;
  for (const [k, v] of recent) { if (recentBytes <= 300 * 1048576 || recent.size <= 1) break; recent.delete(k); recentBytes -= v.byteLength; }
}
function vStarUI() { const on = favs.has(shown[vIdx]?.id); $('vStar').textContent = on ? '★ Favourite' : '☆ Favourite'; $('vStar').classList.toggle('on', on); }
async function openViewer(i) {
  const f = shown[i]; if (!f) return;
  vIdx = i; const seq = ++vSeq;
  $('viewer').hidden = false;
  if (!viewer) { viewer = new Viewer($('vCanvasWrap')); viewer.opts.grid = $('vGrid').checked; viewer.opts.wire = $('vWire').checked; }
  history.replaceState(null, '', '#' + shareHash(f));
  $('vName').textContent = f.name; $('vPath').textContent = f.path || '/';
  $('vDrive').hidden = MOCK; $('vDrive').href = `https://drive.google.com/file/d/${f.id}/view`;
  vStarUI();
  $('vStats').textContent = ''; $('vAnimWrap').hidden = true; $('vLoading').hidden = false; $('vLoading').textContent = 'Loading ' + fmtSize(f.size) + '...';
  viewer.clear();
  try {
    const buf = recent.get(f.id) || await source.bytes(f.id, (got, total) => {
      if (seq === vSeq) $('vLoading').textContent = `Loading ${fmtSize(got)} / ${fmtSize(total || f.size)}`;
    }, f.size);
    remember(f.id, buf);
    if (seq !== vSeq) return;
    $('vLoading').textContent = 'Building...';
    vBuf = buf; await showBuf(false);
    $('vLoading').hidden = true;
  } catch (e) { if (seq === vSeq) $('vLoading').textContent = 'Could not load: ' + (e.message || e); if (e instanceof drive.NeedSignIn) fail(e); }
}
const m = v => v >= 1 ? v.toFixed(2) + ' m' : v >= 0.01 ? (v * 100).toFixed(1) + ' cm' : (v * 1000).toFixed(1) + ' mm';
async function showBuf(keepCam) {
  const f = shown[vIdx], gltf = await parse(vBuf.slice(0));
  const s = viewer.show(gltf, $('vLook').value, keepCam);
  store.set(metaKey(f), { tris: s.tris, anims: s.animations.length });
  const [x, y, z] = s.dims;
  const rows = [['Size (W x H x D)', `${m(x)} x ${m(y)} x ${m(z)}`], ['Triangles', s.tris.toLocaleString()], ['Meshes', s.meshes], ['Materials', s.materials], ['Animations', s.animations.length], ['File', fmtSize(f.size)], ['Modified', new Date(f.modifiedTime).toLocaleDateString()]];
  if (viewer.opts.grid) rows.push(['Grid cell', m(viewer.gridCell)]);
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
function closeViewer() { $('viewer').hidden = true; vSeq++; if (viewer) viewer.clear(); vBuf = null; pumpThumbs(); history.replaceState(null, '', location.pathname + location.search); }
$('vClose').onclick = closeViewer;
$('viewer').onclick = e => { if (e.target === $('viewer')) closeViewer(); };
$('vPrev').onclick = () => openViewer((vIdx - 1 + shown.length) % shown.length);
$('vNext').onclick = () => openViewer((vIdx + 1) % shown.length);
$('vLook').onchange = () => { store.lsSet('look', $('vLook').value); if (vBuf) showBuf(true); };
$('vAnim').onchange = () => viewer.play(+$('vAnim').value);
$('vGrid').onchange = () => { store.lsSet('grid', $('vGrid').checked ? '1' : ''); viewer.set('grid', $('vGrid').checked); if (vBuf) showBuf(true); };
$('vWire').onchange = () => viewer.set('wire', $('vWire').checked);
$('vBg').onchange = () => { $('vCanvasWrap').dataset.bg = $('vBg').value; store.lsSet('bg', $('vBg').value); };
$('vStar').onclick = () => toggleFav(shown[vIdx].id);
$('vPng').onclick = async () => { if (vBuf) saveBlob(await viewer.png(), shown[vIdx].name.replace(/\.glb$/i, '') + '.png'); };
$('vDownload').onclick = () => { if (vBuf) saveBlob(new Blob([vBuf], { type: 'model/gltf-binary' }), shown[vIdx].name); };
const shareHash = f => (MOCK ? '' : 'd=' + folderId + '&') + 'f=' + f.id;
$('vLink').onclick = async () => {
  const url = location.origin + location.pathname + location.search + '#' + shareHash(shown[vIdx]);
  try { await navigator.clipboard.writeText(url); toast('Link copied. It opens for anyone this file is shared with.'); }
  catch { prompt('Copy this link:', url); }
};
addEventListener('keydown', e => {
  if ($('viewer').hidden || e.target.tagName === 'SELECT') return;
  if (e.key === 'Escape') closeViewer();
  else if (e.key === 'ArrowLeft') $('vPrev').click();
  else if (e.key === 'ArrowRight') $('vNext').click();
});

// ---------- start ----------
$('hideWip').checked = store.lsGet('hideWip') === '1';
$('vLook').value = store.lsGet('look') || 'pupkins';
$('sort').value = store.lsGet('sort') || 'name';
$('vGrid').checked = store.lsGet('grid') === '1';
$('vBg').value = store.lsGet('bg') || 'light'; $('vCanvasWrap').dataset.bg = $('vBg').value;
if (store.lsGet('zoom')) { $('zoom').value = store.lsGet('zoom'); $('zoom').oninput(); }
const hp = new URLSearchParams(location.hash.slice(1));
pendingFile = hp.get('f');
authUI();
if (MOCK) { $('folderForm').hidden = true; openFolder('mock'); }
else {
  const last = store.lsGet('folder'), linkFolder = hp.get('d');
  if (last) $('folderInput').value = last;
  const id = linkFolder || (last && drive.parseFolderId(last));
  if (linkFolder && linkFolder !== drive.parseFolderId(last || '')) $('folderInput').value = 'https://drive.google.com/drive/folders/' + linkFolder;
  if (id) openFolder(id);
  render();
  if (!drive.hasClientId()) status('Setup needed: add the OAuth client ID to config.js (see docs/SETUP_GOOGLE.md).', 'err');
}
