# Distribution and Marketplace readiness

Checked against Elgato's official documentation on 28 October 2026. The current work is a development build for operator acceptance, not a Marketplace submission. Changes to the Stream Deck UI are expected after hands-on testing.

## Keep three independently updateable plugins

| Component | Install location/runtime | Role |
|---|---|---|
| Midi Fadester | OBS Studio 33 on Windows x64 and macOS 13.0+ | Optional integration that owns slots, MIDI control, filter bindings and the vendor API (0.6.0 release archives are Windows x64; macOS CoreMIDI builds from `main`). |
| Fadester for OBS | Stream Deck 7.6+ on Windows 10+ and macOS 13.5+ (and OpenDeck) | Provides dial/key controls, a Neo Info Bar display, VJster actions, and configuration. Updates independently of the OBS plugins. |
| Visual Sidechain | OBS Studio 33 on Windows x64 | Optional audio modulation, shader effects, and Tape Deck; can consume Midi's 18 slots or expose numeric filter settings for Midi to control. |

Use one coordinated setup guide and a tested compatibility matrix. An optional combined OBS installer could later offer Midi and Visual Sidechain as separate choices, but each plugin should keep independent versions, uninstall behavior and downloads. Do not bundle OBS binaries into the Stream Deck plugin. Keep the two OBS components optional for users who need only one. For Stream Deck users, clearly disclose that Midi Fadester is optional for the main OBS controls and required for its two optional actions; Visual Sidechain is optional.

Retain the existing plugin/action UUIDs. Use a new package version when publishing an update; do not change identities to distribute a revised implementation. Keep development packages off Marketplace until the operator signs off on real hardware behavior.

## Operator acceptance before submission

- Test on the actual Stream Deck +: rotation, fine/coarse steps, short press, hold, touch rails, and immediate/timed keys. Specifically confirm that zero aborts a partial T-bar throw and Finish commits it.
- Test the Neo Info Bar on a real Stream Deck Neo, including scene changes, Studio Mode changes, disconnection, and reconnection. Confirm the display stays readable with long scene names.
- Confirm Clean FX resets enabled filters in either bank, leaves audio/opacity/A/B controls unchanged, and handles missing/re-added filters. Check custom All FX labels and mapped units.
- Configure a slot entirely in the inspector; test partial ranges, full-range reset, enabled state, calibration, save/reopen, rapid source changes and catalog failures. Pending edits must stay intact.
- Exercise wrong password, disconnected OBS, reconnect and Midi 0.3 compatibility. Confirm the exact required OBS/Stream Deck versions and Windows support in the listing.
- Load a controller profile only in a disposable test setup: it replaces all slot assignments. Keep unsupported physical controllers marked Beta.

The browser harness and automated suites help catch regressions but do not replace this device pass. Live OBS automation for this workspace must use the approved Midi `scripts/run-live-selftest.ps1` wrapper; do not run the older separate-root conformance script.

## Packaging and submission

Run `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run validate`, and `npm run test:mutation`, then `npm run pack`. Packaging produces a `.streamDeckPlugin` file; it does not publish or install the plugin. Elgato's CLI validates and bundles the `.sdPlugin` directory. [Official distribution guide](https://docs.elgato.com/streamdeck/sdk/introduction/distribution/).

Review the plugin metadata, names, icons, feedback and inspector behavior. Action settings should save on change; the explicit Apply control here edits a shared OBS configuration, not the action's saved settings. Confirm readable touch targets, validation feedback, and action-list icon styling before submission. Ensure the manifest Author matches the chosen Maker organization. [Official plugin guidelines](https://docs.elgato.com/guidelines/stream-deck/plugins/).

Prepare the package, name/description, release notes, support/setup links, a 1920×960 PNG thumbnail, and three gallery items using the required image/video formats. Register/sign in to Maker Console, choose **Create product → Stream Deck plugin**, upload, complete the listing, and submit for Elgato review. Choose the product name and monetization deliberately because those are not freely editable in Maker Console. No account, agreement, upload or submission is performed by this integration task. [Official submission guide](https://docs.elgato.com/maker-console/submitting-products/).

Use screenshots from the final approved UI and real hardware, not the fake-server harness as evidence of device verification. Keep a public setup/troubleshooting page explaining how to enable OBS WebSocket and connect, and how to install optional Midi Fadester and Visual Sidechain integrations. Publish only after the operator has approved the hardware pass and Elgato has completed its review.

## Public introduction after final acceptance

The operator wants an OBS Reddit introduction only when the workflow is final and a sizzle video introduces all three plugins. First complete the hardware pass and remaining UI changes, then capture the finished workflow. A short sequence can introduce Midi's shared controls, show Stream Deck configuring and operating them, and finish with Visual Sidechain's reactive effects and Clean. Prepare the post around that real demonstration and obtain the operator's approval before posting. No video production or public posting is part of this integration pass.

## Version numbers at a release

A tag `vX.Y.Z` releases Fadester for OBS X.Y.Z; `package.json` and the plugin's `manifest.json` must say the same (the release workflow checks it). Two other things are attached to every release under versions of their own, and the workflow's job **Companion and VJster extension versions moved with their code** (`scripts/release-component-versions.mjs`) stops a tag that changed one of them without raising its number. Each is compared with the release that first carried its present version:

| Component | Raise | When any of these changed since that release |
|---|---|---|
| Fadester Companion | `components.companion.version` in `installer/components.json`, and what the tests keep equal to it (`tourbox/macos/panel/Info.plist`; `tests/companion-one-name.test.ts` names the rest) | `tourbox/`, `vjster-page/`, `src/vjster/shared/`, and the three files of `vjster-extension/src/` the OBS page is built from (`adapter-core.ts`, `link-client.ts`, `page-state.ts`) |
| VJster Chrome extension | `version` in `vjster-extension/manifest.json` | `vjster-extension/`, `src/vjster/shared/` |

The second pass (branches `pass2/plugin` and `pass2/companion`) changed both and raised neither, on purpose: version numbers move in one separate step, when the suite goes to 1.5. Do that step in this order; each line names every file that holds the number.

1. **Fadester for OBS** (the tag's number, `X.Y.Z`):
   - `package.json` (`version`), then `npm install --package-lock-only` so `package-lock.json` follows;
   - `io.github.jbrick2070.fadester-for-obs.sdPlugin/manifest.json` (`Version`, as `X.Y.Z.0`);
   - `README.md`: the first paragraph (**Fadester for OBS X.Y.Z**) and the example foot line under "Then, if you like" (`Fadester for OBS X.Y.Z · Connected to OBS …`).
2. **The standalone VJster plugin**: `Version` in `com.jbrick2070.vjster.sdPlugin/manifest.json` (four parts), and the number in the first line of `docs/vjster/README.md` (**VJster A.B.C**) and in `docs/vjster/TESTING.md` ("… `manifest.json` (A.B.C.0 today)"). It is not attached to this repository's releases, so no job checks it; its keys, pages and languages changed in the second pass.
3. **The VJster Chrome extension**: `version` in `vjster-extension/manifest.json`. Nothing else holds it. (`components.vjsterExtension.version` in `installer/components.json` is the version Suite Setup installs, which is behind it today; it moves with the pins in step 8.)
4. **Fadester Companion**: `components.companion.version` in `installer/components.json` and `CFBundleShortVersionString` in `tourbox/macos/panel/Info.plist`. `tests/companion-one-name.test.ts` fails when the two differ; the Windows build and both workflows read the number from `components.json`.
5. **Refresh the copies**: `npm run suite:assemble`. It rewrites `assets/manifest.json` (a copy of the Fadester manifest) and `io.github.jbrick2070.fadester-for-obs.sdPlugin/vjster/manifest.json` (a copy of the VJster manifest); until it has run, `tests/suite-assemble.test.ts` reports both as different. Then `npm run build`, which also rebuilds the bundled profiles.
6. **The changelog**: the **Unreleased** heading in `CHANGELOG.md` becomes the new version and date, with its first line saying which Companion and extension versions the release ships.
7. **Check**: `npm test`, `npm run build`, `npm run validate`, and `node scripts/release-component-versions.mjs` (after `git fetch --tags`): every line must start with `ok`.
8. **After the release is published**, not before: `node installer/update-pins.mjs …` rewrites the version, address and checksum of each pinned download in `installer/components.json` (`fadesterForObs`, `vjsterExtension`, `midiFadester`, `playlister`) and the example in `installer/README.md`. Until then those entries are only the labels of the last published files; a candidate build takes the plugin's version from the candidate itself.

Version numbers that are floors, not the current version, stay as they are unless the requirement itself changes: "VJster 0.2.1 or later", "Fadester for OBS 0.11.0", "Visual Sidechain 0.6.0" and "Stream Deck 7.6" in `demo-kit/README.md` (the phrases `demo-kit/kit_docs.py` `README_MUSTS` requires there, so change both together), "Fadester for OBS 0.12.14 (or later) and VJster 0.2.1" in `demo-kit/TESTING.md`, "Midi Fadester 0.9.0 or newer" in the plugin's texts, and the tag in the example of `.github/workflows/suite-installer.yml`. The version numbers inside `tests/release-component-versions.test.ts` are a pretend history and never change.

To see what a tag would say before pushing it: `node scripts/release-component-versions.mjs` (it needs the release tags: `git fetch --tags`).
