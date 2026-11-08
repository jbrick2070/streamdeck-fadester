#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
app="$PWD/build/Fadester Native Slider Experimental.app"
mkdir -p "$app/Contents/MacOS"
cp Info.plist "$app/Contents/Info.plist"
architecture="$(/usr/bin/uname -m)"
case "$architecture" in arm64|x86_64) ;; *) echo 'Unsupported architecture' >&2; exit 2;; esac
/usr/bin/swiftc -swift-version 5 -parse-as-library -O -warnings-as-errors \
  -target "$architecture-apple-macosx12.0" -framework AppKit -framework ApplicationServices \
  Protocol.swift NativeLease.swift AXSlider.swift SelfTests.swift Main.swift -o "$app/Contents/MacOS/FadesterNativeSlider"
/usr/bin/codesign --force --sign - --identifier io.github.jbrick2070.fadester-tourbox.native-slider.experimental "$app"
/usr/bin/codesign --verify "$app"
echo "Built experimental native slider ($architecture); no OBS access or GUI launch."
