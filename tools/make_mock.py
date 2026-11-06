"""Build mock data for ?mock test mode (no Google needed).

Copies a few small GLBs from Ruben HQ's Asset Library into mock/glb/<id>.glb and writes mock/files.json
in the same shape the app builds from Drive: [{id, name, path, size, modifiedTime}].
Run:  python -I tools/make_mock.py
"""
import json, os, random, shutil, hashlib, datetime, pathlib

HERE = pathlib.Path(__file__).resolve().parent.parent
LIB = HERE.parent.parent.parent / "Asset Library"
OUT = HERE / "mock"
# (source folder in Asset Library, fake Drive path, how many)
PICKS = [
    ("moku/pupkins-hub", "Moku/Pupkins", 14),
    ("kenney/furniture-kit", "Kenney/Furniture", 12),
    ("kenney/graveyard-kit", "Kenney/Graveyard", 10),
    ("kenney/toy-car-kit", "Kenney/Toy Cars", 8),
    ("ours/party", "Ours/Party", 10),
    ("ours/party", "Ours/Party/_WIP", 4),
]
MAX = 3 * 1024 * 1024


def main():
    random.seed(7)
    if OUT.exists():
        shutil.rmtree(OUT / "glb", ignore_errors=True)
    (OUT / "glb").mkdir(parents=True, exist_ok=True)
    files, used = [], set()
    for src, path, n in PICKS:
        pool = [p for p in (LIB / src).rglob("*.glb") if p.stat().st_size < MAX and p not in used]
        for p in random.sample(pool, min(n, len(pool))):
            used.add(p)
            fid = hashlib.sha1(str(p).encode()).hexdigest()[:16]
            shutil.copyfile(p, OUT / "glb" / f"{fid}.glb")
            st = p.stat()
            files.append({"id": fid, "name": p.name, "path": path, "size": st.st_size,
                          "modifiedTime": datetime.datetime.fromtimestamp(st.st_mtime, datetime.timezone.utc).isoformat()})
    (OUT / "files.json").write_text(json.dumps(files, indent=1), encoding="utf-8")
    print(len(files), "mock files ->", OUT)


if __name__ == "__main__":
    main()
