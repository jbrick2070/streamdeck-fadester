#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
app="$PWD/build/Fadester Native Write Probe.app"
mkdir -p "$app/Contents/MacOS"
cp Info.plist "$app/Contents/Info.plist"
architecture="$(/usr/bin/uname -m)"
case "$architecture" in arm64|x86_64) ;; *) echo 'Unsupported build architecture' >&2; exit 2;; esac
/usr/bin/swiftc -swift-version 5 -O -warnings-as-errors -target "$architecture-apple-macosx12.0" \
  -framework AppKit -framework ApplicationServices Main.swift \
  -o "$app/Contents/MacOS/FadesterNativeWriteProbe"
/usr/bin/codesign --force --sign - \
  --identifier io.github.jbrick2070.fadester-tourbox.native-write-probe "$app"
/usr/bin/codesign --verify "$app"
echo "Built $app ($architecture). Development/ad-hoc signed; not launched."
