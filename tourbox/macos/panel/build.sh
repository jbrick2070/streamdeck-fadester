#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
repo="$(cd ../../.. && pwd)"
mode="${1:-}"
if [[ -n "$mode" && "$mode" != --ui-only ]]; then echo 'Usage: build.sh [--ui-only]' >&2; exit 2; fi
architecture="$(uname -m)"
case "$architecture" in arm64) rid=osx-arm64;; x86_64) rid=osx-x64;; *) echo 'Unsupported architecture' >&2; exit 2;; esac
app="$PWD/build/Fadester Companion.app"
if [[ "$mode" == --ui-only ]]; then app="$PWD/build/Fadester Companion UI Preview.app"; fi
python="${PYTHON:-python3}"
resources="$app/Contents/Resources"
mkdir -p "$app/Contents/MacOS" "$resources/presets" "$resources/artwork/icons"
cp Info.plist "$app/Contents/Info.plist"
"$python" "$repo/tourbox/presets/build.py" --check
"$python" "$repo/tourbox/presets/build_macos.py" --check
cp "$repo/tourbox/presets/map.json" "$resources/presets/"
cp "$repo/tourbox/presets/macos/OBS Fadester for TourBox.tb" "$resources/presets/"
cp "$repo/tourbox/artwork/icons/"*.png "$resources/artwork/icons/"
icon_src="$repo/tourbox/store/assets/Square44x44Logo.targetsize-256.png"
if [[ -f "$icon_src" ]]; then
  iconset="$PWD/build/AppIcon.iconset"
  rm -rf "$iconset"
  mkdir -p "$iconset"
  for spec in "16 icon_16x16.png" "32 icon_16x16@2x.png" "32 icon_32x32.png" "64 icon_32x32@2x.png" "128 icon_128x128.png" "256 icon_128x128@2x.png" "256 icon_256x256.png" "512 icon_256x256@2x.png" "512 icon_512x512.png" "1024 icon_512x512@2x.png"; do
    px="${spec%% *}"
    name="${spec#* }"
    /usr/bin/sips -s format png -z "$px" "$px" "$icon_src" --out "$iconset/$name" >/dev/null
  done
  /usr/bin/iconutil -c icns "$iconset" -o "$resources/AppIcon.icns"
  rm -rf "$iconset"
fi
cp "$repo/LICENSE" "$resources/LICENSE"
cp README.md "$resources/README.md"
"$python" make-guide.py "$resources/START-HERE.html"
/usr/bin/swiftc -swift-version 5 -parse-as-library -O -warnings-as-errors \
  -target "$architecture-apple-macosx12.0" -framework AppKit -framework ApplicationServices -framework CryptoKit \
  Model.swift ObsDiscovery.swift HostController.swift ShowMe.swift Panel.swift Main.swift \
  -o "$app/Contents/MacOS/FadesterTourBoxPanel"
if [[ "$mode" != --ui-only ]]; then
  dotnet="${DOTNET:-}"
  if [[ -z "$dotnet" ]]; then
    if command -v dotnet >/dev/null; then dotnet="$(command -v dotnet)"; else dotnet="$HOME/.dotnet/dotnet"; fi
  fi
  mkdir -p "$resources/runtime" "$resources/vjster/obs"
  vjster_obs=""
  for candidate in "$repo/io.github.jbrick2070.fadester-for-obs.sdPlugin/bin/vjster/obs" "$repo/com.jbrick2070.vjster.sdPlugin/bin/obs"; do
    if [[ -f "$candidate/player.html" && -f "$candidate/player.js" ]]; then vjster_obs="$candidate"; break; fi
  done
  if [[ -z "$vjster_obs" ]]; then
    export PATH="$HOME/.local/node/bin:$PATH"
    (cd "$repo" && npm run build:vjster-page)
    vjster_obs="$repo/com.jbrick2070.vjster.sdPlugin/bin/obs"
  fi
  cp "$vjster_obs/player.html" "$vjster_obs/player.js" "$resources/vjster/obs/"
  "$dotnet" publish "$repo/tourbox/macos/host/FadesterMacHost.csproj" -c Release -r "$rid" --self-contained true \
    -p:PublishSingleFile=true -p:DebugType=None -o "$resources/runtime" --nologo
  bash "$repo/tourbox/macos/native/build.sh"
  bash "$repo/tourbox/macos/input/build.sh"
  /usr/bin/ditto "$repo/tourbox/macos/native/build/Fadester Native Slider Experimental.app" "$resources/runtime/Fadester Native Slider Experimental.app"
  /usr/bin/ditto "$repo/tourbox/macos/input/build/Fadester Mac Shortcuts Experimental.app" "$resources/runtime/Fadester Mac Shortcuts Experimental.app"
  /usr/bin/codesign --force --sign - --identifier io.github.jbrick2070.fadester-tourbox.host.experimental "$resources/runtime/FadesterMacHost"
  mkdir -p "$resources/runtime-notices"
  sdkroot="${DOTNET_ROOT:-$(dirname "$dotnet")}"
  cp "$sdkroot/LICENSE.txt" "$sdkroot/ThirdPartyNotices.txt" "$resources/runtime-notices/"
  "$resources/runtime/FadesterMacHost" --self-test
  "$resources/runtime/Fadester Native Slider Experimental.app/Contents/MacOS/FadesterNativeSlider" --self-test
  "$resources/runtime/Fadester Mac Shortcuts Experimental.app/Contents/MacOS/FadesterMacShortcuts" --self-test --map "$resources/presets/map.json"
fi
/usr/bin/codesign --force --sign - --identifier io.github.jbrick2070.fadester-tourbox.panel.experimental "$app"
/usr/bin/codesign --verify --deep --strict "$app"
"$app/Contents/MacOS/FadesterTourBoxPanel" --self-test
echo "Built $app ($architecture). Experimental ad-hoc signature only; not notarized. No live OBS, shortcuts or GUI launched."
