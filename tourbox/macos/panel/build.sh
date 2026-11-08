#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
repo="$(cd ../../.. && pwd)"
mode="${1:-}"
if [[ -n "$mode" && "$mode" != --ui-only ]]; then echo 'Usage: build.sh [--ui-only]' >&2; exit 2; fi
architecture="$(uname -m)"
case "$architecture" in arm64) rid=osx-arm64;; x86_64) rid=osx-x64;; *) echo 'Unsupported architecture' >&2; exit 2;; esac
app="$PWD/build/OBS Fadester for TourBox Experimental.app"
if [[ "$mode" == --ui-only ]]; then app="$PWD/build/OBS Fadester for TourBox UI Preview.app"; fi
python="${PYTHON:-python3}"
resources="$app/Contents/Resources"
mkdir -p "$app/Contents/MacOS" "$resources/presets"
cp Info.plist "$app/Contents/Info.plist"
"$python" "$repo/tourbox/presets/build.py" --check
"$python" "$repo/tourbox/presets/build_macos.py" --check
cp "$repo/tourbox/presets/map.json" "$resources/presets/"
cp "$repo/tourbox/presets/macos/OBS Fadester for TourBox.tb" "$resources/presets/"
cp "$repo/LICENSE" "$resources/LICENSE"
cp README.md "$resources/README.md"
"$python" make-guide.py "$resources/START-HERE.html"
/usr/bin/swiftc -swift-version 5 -parse-as-library -O -warnings-as-errors \
  -target "$architecture-apple-macosx12.0" -framework AppKit -framework CryptoKit \
  Model.swift ObsDiscovery.swift HostController.swift Panel.swift Main.swift \
  -o "$app/Contents/MacOS/FadesterTourBoxPanel"
if [[ "$mode" != --ui-only ]]; then
  dotnet="${DOTNET:-}"
  if [[ -z "$dotnet" ]]; then
    if command -v dotnet >/dev/null; then dotnet="$(command -v dotnet)"; else dotnet="$HOME/.dotnet/dotnet"; fi
  fi
  mkdir -p "$resources/runtime"
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
