# SPDX-License-Identifier: GPL-2.0-or-later
"""Suite Demo Kit: the zip that ships (plan section 5, step 5).

build_zip() packs exactly the files README.md's "What is in the zip" table names, all at the
zip's root so that unzipping into C:\\SuiteDemoKit gives C:\\SuiteDemoKit\\Suite Demo Kit.json:

- Suite Demo Kit.json: kit-template.json as committed, byte for byte;
- media/: the files kit_collection.MEDIA_FILES names, each checked against the media
  manifest's SHA-1 first (the manifest, not the folder: an earlier --with-spare run can leave
  clip-marathon.mp4 in build/media, and it does not ship);
- vjster-setup.html, README.md, CREDITS.md from demo-kit/;
- the two profiles kit_docs.PROFILE_FILES names, from build/profiles (scripts/build-kit-profiles.ts).

The zip is the same bytes every time from the same inputs: entries sorted, one fixed time
stamp, fixed permissions, deflate, and the text files (.json, .md, .html) with LF line ends
whatever git's autocrlf left in the working copy. Next to it, kit-zip.json lists each entry's SHA-256 and size.
An earlier zip that differs is renamed aside (.runN), never deleted or overwritten.
"""
from __future__ import annotations

import hashlib
import io
import json
import re
import zipfile
from pathlib import Path

import kit_collection as kc
import kit_docs as kd
from kit_obs import keep_aside

KIT_DIR = Path(__file__).resolve().parent
ZIP_NAME = f"Suite-Demo-Kit-{kd.KIT_VERSION}.zip"
ZIP_TIME = (2026, 11, 1, 0, 0, 0)
DOCS = ["README.md", "CREDITS.md", kc.SETUP_CARD]


def zip_entries(kit_dir: Path = KIT_DIR, build: Path | None = None) -> list[tuple[str, Path]]:
    """(name in the zip, file on disk) for every file that ships, sorted; refuses a media file
    that is not the manifest's, and a missing profile."""
    build = kit_dir / "build" if build is None else build
    manifest = json.loads((build / "media-manifest.json").read_text(encoding="utf-8"))
    listed = {f["path"]: f for f in manifest["files"]}
    problems: list[str] = []
    entries: list[tuple[str, Path]] = [(kd.COLLECTION_FILE, kit_dir / "kit-template.json")]
    for rel in kc.MEDIA_FILES:
        source = build / rel
        entry = listed.get(rel)
        if entry is None:
            problems.append(f"{rel} is not in the media manifest")
        elif not source.is_file():
            problems.append(f"{source} is missing; run build-kit.py media")
        elif hashlib.sha1(source.read_bytes()).hexdigest() != entry["sha1"]:
            problems.append(f"{source} does not match the media manifest")
        entries.append((rel, source))
    for name in DOCS:
        entries.append((name, kit_dir / name))
    for name in kd.PROFILE_FILES:
        source = build / "profiles" / name
        if not source.is_file():
            problems.append(f"{source} is missing; run node --import tsx scripts/build-kit-profiles.ts")
        entries.append((name, source))
    for _, source in entries:
        if not source.is_file() and not any(str(source) in p for p in problems):
            problems.append(f"{source} is missing")
    if problems:
        raise RuntimeError("the kit zip cannot be built: " + "; ".join(problems))
    return sorted(entries)


def readme_zip_names(readme: str) -> list[str]:
    """The top-level names README.md's "What is in the zip" table promises (media/ as a folder)."""
    section = readme.split("## What is in the zip", 1)[1].split("\n## ", 1)[0]
    cells = [line.split("|")[1] for line in section.splitlines() if line.startswith("| `")]
    return sorted(name for cell in cells for name in re.findall(r"`([^`]+)`", cell))


def zip_bytes(entries: list[tuple[str, Path]]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name, source in entries:
            info = zipfile.ZipInfo(name, ZIP_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            info.create_system = 0
            z.writestr(info, file_bytes(name, source))
    return buffer.getvalue()


TEXT_SUFFIXES = (".json", ".md", ".html")


def file_bytes(name: str, source: Path) -> bytes:
    """A file as it ships: the text files with LF line ends whatever git's autocrlf did to the
    working copy, so every checkout packs the same zip."""
    data = source.read_bytes()
    return data.replace(b"\r\n", b"\n") if name.endswith(TEXT_SUFFIXES) else data


def build_zip(out: Path, kit_dir: Path = KIT_DIR, build: Path | None = None) -> dict:
    """Write the kit zip and kit-zip.json into out; returns the listing."""
    entries = zip_entries(kit_dir, build)
    data = zip_bytes(entries)
    out.mkdir(parents=True, exist_ok=True)
    target = out / ZIP_NAME
    if target.exists() and target.read_bytes() != data:
        keep_aside(target)
    if not target.exists():
        target.write_bytes(data)
    listing = {"zip": ZIP_NAME, "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
               "size": target.stat().st_size,
               "files": [{"path": name, "sha256": hashlib.sha256(file_bytes(name, src)).hexdigest(),
                          "size": len(file_bytes(name, src))} for name, src in entries]}
    (out / "kit-zip.json").write_text(json.dumps(listing, indent=1) + "\n", encoding="utf-8", newline="\n")
    return listing
