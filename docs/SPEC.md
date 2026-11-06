# GLB Viewer: spec (2026-11-06)

Private GLB library viewer for Ruben, Aeryn and a few devs. Static site (GitHub Pages). The GLBs stay in
Ruben's Google Drive folder "3D Assets"; the site stores no assets and no secrets.

## Privacy model
- Each viewer signs in with Google. Drive only returns files shared with that account.
- Privacy comes from Drive sharing, not from the site, so a public repo is fine.
- The OAuth client ID is public config (`config.js`), not a secret. No client secret exists (token flow).

## Auth
- Google Identity Services token flow (`google.accounts.oauth2.initTokenClient`), no backend.
- Scope: `https://www.googleapis.com/auth/drive.readonly`. This is the smallest scope that can both list a
  shared folder AND download file bytes (`drive.metadata.readonly` cannot download; `drive.file` only sees files
  the app created or the user picked one by one).
- OAuth app stays in Testing mode: only listed test users (Ruben, Aeryn, later devs; max 100) can sign in.
- Access token lives ~1 h, kept in sessionStorage; on expiry/401 the app silently asks GIS for a new one.

## Data
- Paste a Drive folder link (or a bare ID). Accepted: `.../folders/<id>`, `...?id=<id>`, `<id>`.
- Listing: Drive API v3 `files.list`, `q='<id>' in parents and trashed=false`, `pageSize=1000`, paged, all
  subfolders walked (4 in parallel), shared drives supported. Fields: id, name, mimeType, size, modifiedTime.
- Only `.glb` files are shown. Each file gets its folder path (Origin/Category/...).
- Listing is cached in IndexedDB per folder; **Refresh** re-lists (new Drive uploads show up, no redeploy).
- Last folder link remembered per browser (localStorage).
- File bytes: `GET files/<id>?alt=media` with `Authorization: Bearer <token>` (CORS OK).

## UI
- Top bar: Sign in / out, folder link field + Open, search box, Refresh, "hide _WIP" toggle, count.
- Left: folder tree with counts; click = filter to that folder.
- Grid: cards grouped by folder (section headers), name + size, `WIP` badge for `_WIP` paths.
- Search: case-insensitive, every word must match name or folder path.
- Thumbnails: rendered in the browser, one shared offscreen three.js renderer, lazy (IntersectionObserver),
  2 at a time, cached in IndexedDB keyed `fileId|modifiedTime`. Files over 40 MB: no auto thumbnail
  (button "render").
- Click a card = viewer: orbit/zoom, look toggle Pupkins 3-band toon (`toon_look.js`) / plain, animation
  picker, stats (tris, meshes, materials, size), folder path, Download, Open in Drive. Esc closes, arrows = prev/next.
- Loaders: GLTFLoader + Draco + Meshopt (pinned three r170 from jsdelivr).

## Test mode
- `?mock` = no Google: listing from `mock/files.json`, bytes from `mock/glb/<id>.glb` (local copies, gitignored).
  Made by `tools/make_mock.py`.

## Out of scope
- Uploading, renaming, deleting. Server code. Asset storage. Thumbnail sharing between viewers.
