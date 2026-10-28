# Distribution and Marketplace readiness

Checked against Elgato's official documentation on 28 October 2026. The current work is a development build for operator acceptance, not a Marketplace submission. Changes to the Stream Deck UI are expected after hands-on testing.

## Keep three independently updateable plugins

| Component | Install location/runtime | Role |
|---|---|---|
| Midi Fadester | OBS Studio 33 on Windows x64 | Owns slots, MIDI control, filter bindings and the vendor API. Required by Fadester for OBS. |
| Fadester for OBS | Stream Deck 7.1+ | Provides dial/key controls and configuration. Updates independently of the OBS plugins. |
| Visual Sidechain | OBS Studio 33 on Windows x64 | Optional audio modulation and shader effects; can consume Midi's 18 slots or expose numeric filter settings for Midi to control. |

Use one coordinated setup guide and a tested compatibility matrix. An optional combined OBS installer could later offer Midi and Visual Sidechain as separate choices, but each plugin should keep independent versions, uninstall behavior and downloads. Do not bundle OBS binaries into the Stream Deck plugin. Keep the two OBS components optional for users who need only one. For Stream Deck users, clearly disclose that Midi is required and Visual Sidechain is optional.

Retain the existing plugin/action UUIDs. Use a new package version when publishing an update; do not change identities to distribute a revised implementation. Keep development packages off Marketplace until the operator signs off on real hardware behavior.

## Operator acceptance before submission

- Test on the actual Stream Deck +: rotation, fine/coarse steps, short press, hold, touch rails, and immediate/timed keys. Specifically confirm that zero aborts a partial T-bar throw and Finish commits it.
- Confirm Clean FX resets enabled filters in either bank, leaves audio/opacity/A/B controls unchanged, and handles missing/re-added filters. Check custom All FX labels and mapped units.
- Configure a slot entirely in the inspector; test partial ranges, full-range reset, enabled state, calibration, save/reopen, rapid source changes and catalog failures. Pending edits must stay intact.
- Exercise wrong password, disconnected OBS, reconnect and Midi 0.3 compatibility. Confirm the exact required OBS/Stream Deck versions and Windows support in the listing.
- Load a controller profile only in a disposable test setup: it replaces all slot assignments. Keep unsupported physical controllers marked Beta.

The browser harness and automated suites help catch regressions but do not replace this device pass. Live OBS automation for this workspace must use the approved Midi `scripts/run-live-selftest.ps1` wrapper; do not run the older separate-root conformance script.

## Packaging and submission

Run `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run validate`, and `npm run test:mutation`, then `npm run pack`. Packaging produces a `.streamDeckPlugin` file; it does not publish or install the plugin. Elgato's CLI validates and bundles the `.sdPlugin` directory. [Official distribution guide](https://docs.elgato.com/streamdeck/sdk/introduction/distribution/).

Review the plugin metadata, names, icons, feedback and inspector behavior. Action settings should save on change; the explicit Apply control here edits a shared OBS configuration, not the action's saved settings. Confirm readable touch targets, validation feedback, and action-list icon styling before submission. Ensure the manifest Author matches the chosen Maker organization. [Official plugin guidelines](https://docs.elgato.com/guidelines/stream-deck/plugins/).

Prepare the package, name/description, release notes, support/setup links, a 1920×960 PNG thumbnail, and three gallery items using the required image/video formats. Register/sign in to Maker Console, choose **Create product → Stream Deck plugin**, upload, complete the listing, and submit for Elgato review. Choose the product name and monetization deliberately because those are not freely editable in Maker Console. No account, agreement, upload or submission is performed by this integration task. [Official submission guide](https://docs.elgato.com/maker-console/submitting-products/).

Use screenshots from the final approved UI and real hardware, not the fake-server harness as evidence of device verification. Keep a public setup/troubleshooting page explaining how to install Midi, enable OBS websocket, connect, and optionally add Visual Sidechain. Publish only after the operator has approved the hardware pass and Elgato has completed its review.

## Public introduction after final acceptance

The operator wants an OBS Reddit introduction only when the workflow is final and a sizzle video introduces all three plugins. First complete the hardware pass and remaining UI changes, then capture the finished workflow. A short sequence can introduce Midi's shared controls, show Stream Deck configuring and operating them, and finish with Visual Sidechain's reactive effects and Clean. Prepare the post around that real demonstration and obtain the operator's approval before posting. No video production or public posting is part of this integration pass.
