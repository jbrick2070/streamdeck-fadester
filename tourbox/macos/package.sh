#!/bin/bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Builds the complete Fadester Companion.app for this Mac's architecture and packs the release ZIP:
#   Fadester-Companion-macOS-<arm64|x64>-<version>.zip (+ .sha256)
# The version is Fadester Companion's in installer/components.json, as for the Windows ZIP.
# The app is ad-hoc signed and not notarized. The packed ZIP is extracted again and its app's
# self-tests run from the extracted copy, so the checks cover the file that ships.
# Usage: package.sh [OUTPUT_DIR]   (default: tourbox/macos/build)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
out="${1:-$here/build}"
mkdir -p "$out"
out="$(cd "$out" && pwd)"
python="${PYTHON:-python3}"
case "$(/usr/bin/uname -m)" in arm64) arch=arm64;; x86_64) arch=x64;; *) echo 'Unsupported architecture' >&2; exit 2;; esac
version="$("$python" -c 'import json, sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["components"]["companion"]["version"])' "$repo/installer/components.json")"
name="Fadester-Companion-macOS-$arch-$version"

# A stale bundle from an earlier build must not leak files into this one.
rm -rf "$repo/tourbox/macos/panel/build/Fadester Companion.app"
bash "$repo/tourbox/macos/panel/build.sh"
app="$repo/tourbox/macos/panel/build/Fadester Companion.app"

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
folder="$stage/Fadester Companion"
mkdir -p "$folder"
/usr/bin/ditto "$app" "$folder/Fadester Companion.app"
# Beside the app, as in the Windows ZIP: the TourBox preset to import (English), the guide, the read-me and the license.
cp "$repo/tourbox/presets/macos/OBS Fadester for TourBox.tb" "$folder/"
cp "$repo/tourbox/presets/macos/OBS Fadester for TourBox (Chrome Video).tb" "$folder/"
cp "$app/Contents/Resources/START-HERE.html" "$folder/START-HERE.html"
# Each language's preset in presets/<locale>/ and quick start in guide/, as in the Windows ZIP.
/usr/bin/ditto "$app/Contents/Resources/guide" "$folder/guide"
for preset in "$app/Contents/Resources/presets/"*/"OBS Fadester for TourBox.tb"; do
  locale="$(basename "$(dirname "$preset")")"
  mkdir -p "$folder/presets/$locale"
  cp "$preset" "$folder/presets/$locale/"
  cp "$(dirname "$preset")/OBS Fadester for TourBox (Chrome Video).tb" "$folder/presets/$locale/"
done
cp "$repo/tourbox/macos/panel/README.md" "$folder/README.md"
cp "$repo/LICENSE" "$folder/LICENSE"
mkdir -p "$folder/runtime-notices"
cp "$app/Contents/Resources/runtime-notices/"* "$folder/runtime-notices/"
printf '%s\n' "${GITHUB_SHA:-$(git -C "$repo" rev-parse HEAD 2>/dev/null || echo unknown)}" > "$folder/SOURCE-COMMIT.txt"

zip="$out/$name.zip"
rm -f "$zip" "$zip.sha256"
# ditto keeps the bundles' structure and signatures intact (plain zip can break them).
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$folder" "$zip"
(cd "$out" && /usr/bin/shasum -a 256 "$name.zip" > "$name.zip.sha256")

# Check the shipped file: extract it fresh and run every self-test from the extracted app.
check="$stage/check"
mkdir -p "$check"
/usr/bin/ditto -x -k "$zip" "$check"
shipped="$check/Fadester Companion/Fadester Companion.app"
runtime="$shipped/Contents/Resources/runtime"
test -f "$check/Fadester Companion/OBS Fadester for TourBox.tb"
test -f "$check/Fadester Companion/OBS Fadester for TourBox (Chrome Video).tb"
test -f "$check/Fadester Companion/START-HERE.html"
test -f "$shipped/Contents/Resources/presets/OBS Fadester for TourBox.tb"
test -f "$shipped/Contents/Resources/vjster/obs/player.html"
# Every language of tourbox/presets/locales.json: its Mac preset (in the app and beside it) and its quick start.
for locale in $("$python" -c 'import json, sys; print(" ".join(sorted(json.load(open(sys.argv[1], encoding="utf-8")))))' "$repo/tourbox/presets/locales.json"); do
  test -f "$shipped/Contents/Resources/presets/$locale/OBS Fadester for TourBox.tb"
  test -f "$shipped/Contents/Resources/presets/$locale/map.json"
  test -f "$shipped/Contents/Resources/guide/$locale.html"
  test -f "$check/Fadester Companion/presets/$locale/OBS Fadester for TourBox.tb"
  test -f "$check/Fadester Companion/presets/$locale/OBS Fadester for TourBox (Chrome Video).tb"
  test -f "$shipped/Contents/Resources/presets/$locale/OBS Fadester for TourBox (Chrome Video).tb"
  test -f "$check/Fadester Companion/guide/$locale.html"
done
test -f "$check/Fadester Companion/guide/quickstart.css"
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$shipped/Contents/Info.plist")" = "$version"
/usr/bin/codesign --verify --deep --strict "$shipped"
for binary in "$shipped/Contents/MacOS/Fadester Companion" "$runtime/FadesterMacHost" \
  "$runtime/Fadester Companion T-bar.app/Contents/MacOS/FadesterNativeSlider" \
  "$runtime/Fadester Companion Shortcuts.app/Contents/MacOS/FadesterMacShortcuts"; do
  /usr/bin/file "$binary" | grep -q "$(/usr/bin/uname -m)" || { echo "Wrong architecture: $binary" >&2; exit 1; }
done
(cd "$stage" && "$shipped/Contents/MacOS/Fadester Companion" --self-test)
(cd "$stage" && "$runtime/FadesterMacHost" --self-test)
"$runtime/Fadester Companion T-bar.app/Contents/MacOS/FadesterNativeSlider" --self-test
"$runtime/Fadester Companion Shortcuts.app/Contents/MacOS/FadesterMacShortcuts" --self-test --map "$shipped/Contents/Resources/presets/map.json"
if command -v node >/dev/null; then
  node "$repo/tourbox/macos/panel/tests/discovery-server.mjs" "$shipped/Contents/MacOS/Fadester Companion"
else
  echo 'node not found: skipped the discovery-server check' >&2
fi
echo "Packed $zip ($(/usr/bin/stat -f %z "$zip") bytes); $(cat "$zip.sha256")"
echo 'Ad-hoc signed, not notarized. No live OBS, shortcuts, Accessibility, Keychain or GUI used by these checks.'
