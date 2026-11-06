// Google sign-in (GIS token flow) + Drive API v3 listing and download. No backend, no secret.
import { CLIENT_ID, SCOPE } from '../config.js';

const API = 'https://www.googleapis.com/drive/v3/files';
const FOLDER = 'application/vnd.google-apps.folder';
let tokenClient = null, token = null, expires = 0, pending = null;

try { const t = JSON.parse(sessionStorage.getItem('gtoken') || 'null'); if (t && t.exp > Date.now() + 60e3) { token = t.tok; expires = t.exp; } } catch { /* ignore */ }

export const hasClientId = () => !!CLIENT_ID;
export const signedIn = () => !!token && expires > Date.now() + 30e3;

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = res; s.onerror = () => rej(new Error('Could not load Google sign-in'));
    document.head.appendChild(s);
  });
}

export class NeedSignIn extends Error { constructor() { super('Signed out (Google tokens last 1 hour). Sign in again.'); } }

// Opens the Google popup: call from a click. After the first consent it closes by itself.
export async function signIn() {
  if (!CLIENT_ID) throw new Error('No OAuth client ID yet: fill config.js (docs/SETUP_GOOGLE.md).');
  if (pending) return pending;
  await loadGis();
  pending = new Promise((res, rej) => {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID, scope: SCOPE,
      callback: r => {
        pending = null;
        if (r.error) return rej(new Error(r.error_description || r.error));
        token = r.access_token; expires = Date.now() + (r.expires_in || 3600) * 1000;
        try { sessionStorage.setItem('gtoken', JSON.stringify({ tok: token, exp: expires })); } catch { /* ignore */ }
        res();
      },
      error_callback: e => { pending = null; rej(new Error(e.message || e.type || 'sign-in cancelled')); },
    });
    tokenClient.requestAccessToken({ prompt: '' });
  });
  return pending;
}

export function signOut() {
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
  token = null; expires = 0;
  try { sessionStorage.removeItem('gtoken'); } catch { /* ignore */ }
}

async function authed(url, opts = {}) {
  if (!signedIn()) throw new NeedSignIn();
  const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token } });
  if (r.status === 401) { signOut(); throw new NeedSignIn(); }
  if (!r.ok) {
    let msg = r.status + ' ' + r.statusText;
    try { msg = (await r.json()).error.message || msg; } catch { /* ignore */ }
    if (r.status === 404) msg = 'Not found, or not shared with this Google account.';
    throw new Error(msg);
  }
  return r;
}

export async function whoAmI() {
  const r = await authed('https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)');
  return (await r.json()).user;
}

// Folder link / id -> id
export function parseFolderId(s) {
  s = (s || '').trim();
  const m = s.match(/\/folders\/([\w-]{10,})/) || s.match(/[?&]id=([\w-]{10,})/) || s.match(/^([\w-]{10,})$/);
  return m ? m[1] : null;
}

async function listChildren(id) {
  const out = [];
  let page = '';
  do {
    const q = new URLSearchParams({
      q: `'${id}' in parents and trashed=false`, pageSize: '1000',
      fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime)',
      supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', corpora: 'allDrives',
    });
    if (page) q.set('pageToken', page);
    const j = await (await authed(API + '?' + q)).json();
    out.push(...j.files); page = j.nextPageToken;
  } while (page);
  return out;
}

// Walk the whole tree (4 folders at a time). onProgress(filesSoFar, foldersLeft)
export async function listTree(rootId, onProgress = () => {}) {
  const meta = await (await authed(`${API}/${rootId}?fields=id,name,mimeType&supportsAllDrives=true`)).json();
  if (meta.mimeType !== FOLDER) throw new Error('That link is a file, not a folder.');
  const files = [], queue = [{ id: rootId, path: '' }];
  let active = 0;
  await new Promise((res, rej) => {
    const pump = () => {
      if (!queue.length && !active) return res();
      while (active < 4 && queue.length) {
        const f = queue.shift(); active++;
        listChildren(f.id).then(kids => {
          for (const k of kids) {
            const p = f.path ? f.path + '/' + k.name : k.name;
            if (k.mimeType === FOLDER) queue.push({ id: k.id, path: p });
            else if (/\.glb$/i.test(k.name)) files.push({ id: k.id, name: k.name, path: f.path, size: +k.size || 0, modifiedTime: k.modifiedTime });
          }
          active--; onProgress(files.length, queue.length + active); pump();
        }, rej);
      }
    };
    pump();
  });
  return { name: meta.name, files };
}

export async function fetchFile(id) {
  return (await authed(`${API}/${id}?alt=media&supportsAllDrives=true`)).arrayBuffer();
}
