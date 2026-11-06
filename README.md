# GLB Library

Private viewer for GLB files kept in Google Drive. Sign in with Google, paste a Drive folder link, browse thumbnails, open
a model in 3D, download it. The site stores no assets: Drive only returns files shared with the signed-in account.

- Setup (Google Cloud, OAuth client): [docs/SETUP_GOOGLE.md](docs/SETUP_GOOGLE.md)
- Spec: [docs/SPEC.md](docs/SPEC.md)
- Local test without Google: `python -I tools/make_mock.py`, serve this folder on port 4231, open `/?mock`.

The OAuth client ID in `config.js` is public config, not a secret.
