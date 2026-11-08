#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
app="$PWD/build/Fadester Mac Shortcuts Experimental.app"
mkdir -p "$app/Contents/MacOS"
cp Info.plist "$app/Contents/Info.plist"
architecture="$(/usr/bin/uname -m)"
case "$architecture" in arm64|x86_64) ;; *) echo 'Unsupported architecture' >&2; exit 2;; esac
/usr/bin/swiftc -swift-version 5 -parse-as-library -O -warnings-as-errors \
  -target "$architecture-apple-macosx12.0" -framework AppKit -framework Carbon \
  Core.swift Main.swift -o "$app/Contents/MacOS/FadesterMacShortcuts"
/usr/bin/codesign --force --sign - --identifier io.github.jbrick2070.fadester-tourbox.shortcuts.experimental "$app"
/usr/bin/codesign --verify "$app"
echo "Built experimental Mac shortcut component ($architecture). No shortcuts registered or app launched."
