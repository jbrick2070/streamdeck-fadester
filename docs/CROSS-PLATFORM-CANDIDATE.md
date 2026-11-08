# Windows and macOS candidate

The same `io.github.jbrick2070.fadester-for-obs.streamDeckPlugin` contains all 17 Fadester and VJster actions for both Windows and macOS. The existing UUID and version 0.10.0 are preserved. The standalone VJster manifest has the same platform declarations, for people who use it separately.

Requirements: Stream Deck 7.6 or later for the suite, Windows 10 or later, or macOS 13.5 or later. The plugin asks Stream Deck to run Node 24; [Node 24's macOS minimum is 13.5](https://nodejs.org/en/blog/migrations/v22-to-v24). One shared JavaScript entry point is used on both operating systems, as supported by the [Stream Deck manifest](https://docs.elgato.com/streamdeck/sdk/references/manifest/).

This is a local test candidate, not a published release or a claim that every device and operating system has been tested.

## Build the combined package

With Node 24 installed, run these commands from the repository root on Windows or macOS:

```sh
npm ci
npm test
node --import tsx scripts/suite/package-candidate.ts
```

The last command builds current sources and bundled profiles, checks package paths with exact filename case, validates both manifests with Elgato's CLI, and produces:

- `release/candidates/windows-macos/io.github.jbrick2070.fadester-for-obs.streamDeckPlugin` — one installer for both platforms, including VJster.
- `release/candidates/windows-macos/vjster-chrome-extension-0.1.0.zip` — the freshly built Chrome companion with every current translation.
- `release/candidates/windows-macos/CANDIDATE.json` — versions, build platform, file sizes, and SHA-256 checksums.

It does not install the plugin, restart applications, change personal profiles, publish, or tag a release. `--check` runs the portability checks against an already built tree without rebuilding. Unit tests and package validation are separate from real host testing.

Do not use older files directly under `release/`: the old Fadester package uses its previous UUID and version, and the old Chrome extension ZIP lacks several current translations. Do not install standalone VJster alongside the suite for the same test: both normally listen on local port 48150.

## Verified Mac results — November 4, 2026

The Apple Silicon test Mac ran **macOS 27.2**, **OBS 33.0.1**, **Stream Deck 7.6.1** and **Node 24.22.2**. The full test run passed **1,695 tests**, with **4 skipped**; **78 test files passed**, with **3 skipped**. Both Elgato manifest validators and the combined package build passed.

The 96 unpacked files compared between the Mac and Windows packages were byte-identical. The Mac-built installer is `release/candidates/windows-macos/mac-built/io.github.jbrick2070.fadester-for-obs.streamDeckPlugin`, with SHA-256:

```text
c202f89734bb9f57adfbb0bd0b8e83a5fc38facd94e14020a3a9e144756ce415
```

The actual Stream Deck host log reported **Plugin connected**, confirming host registration. Saving credentials to the Mac Keychain failed with error **−25293**, so credential persistence is **not validated**. Chrome **157.0.8103.39** was installed, but the companion extension had not yet been loaded or tested. Manual Accessibility permission, actual OBS action checks and physical hardware rehearsal remain pending. These results establish the recorded build and connection checks; they do not establish a complete Mac application or full workflow compatibility.

## Real host acceptance

Install this exact candidate on each test host and record its checksum, OS and CPU architecture, Stream Deck version, and OBS version. Use a disposable OBS scene collection and do not enable streaming or recording for control tests.

1. Confirm all 17 actions appear, the suite's two child processes start and recover, and property inspectors show usable controls and correct localized text. Check key images, dial strips and longer/CJK scene names for clipping or missing glyphs.
2. Authenticate OBS WebSocket locally. Test source visibility, scene selection, Preview/Program guards, transitions and fader endpoints, audio volume/mute/fades, filter ranges, connection loss and reconnection.
3. Import an included profile deliberately and verify that personal profiles are preserved. Test actual keys, dial turns, holds, presses and touch strips on each device model being claimed. A simulated host cannot establish physical-device behavior.
4. Load the freshly built VJster Chrome extension. Test tab selection, pinning, transport, speed and available quality changes. Then test the local VJster page as an OBS browser source: YouTube embed rates and its truthful unsupported-quality state. Confirm loopback pairing and reconnection.
5. Install each optional native OBS dependency built for that host before testing its controls: Playlister, Midi Fadester and Visual Sidechain. Their native binaries are not inside this Stream Deck package. Verify missing dependencies give useful feedback.
6. Whole-mix controls need a running, enabled Fadester mix provider. Sending a command is not proof that it was applied; require the correlated reply and actual OBS gain change. TourBox's companion app has its own platform acceptance work.

The Windows-only OpenDeck parity harness is not a macOS test runner. OpenDeck can be tested separately on macOS using its native installation and profiles; a successful Elgato host test does not establish OpenDeck compatibility.
