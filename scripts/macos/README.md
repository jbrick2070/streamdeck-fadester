# Isolated live suite check on macOS

This developer harness launches a temporary copy of the **built combined suite** and injects Stream Deck SDK events. It connects to an already running, authenticated OBS on **127.0.0.1 only**. It never launches or closes OBS, changes OBS WebSocket settings, installs a plugin, or connects to the Windows machine.

It tests packaged-suite authentication, a scene Cut, source visibility, a volume dial, a timed fade, and VJster child rendering. Optional whole-mix testing requires an independently running, enabled provider and verifies its correlated receipt **and actual OBS gain**, then restores the baseline. It does not test physical hardware, actual Elgato event delivery, native T-bar movement, Chrome playback, or credential persistence.

## Before running

- Use a disposable Mac OBS scene collection, leave all outputs stopped, and do not operate OBS during the test. A prior in-progress transition is refused.
- Enable OBS WebSocket authentication locally. The test does not read stored credentials. Supply the password through a private environment injection; do not put its value in command history, logs, screenshots or an artifact.
- Build the current suite with `node --import tsx scripts/suite/package-candidate.ts`.
- Set `FADESTER_MAC_LIVE=1`, `FADESTER_MAC_OBS_PORT` to the local test port, and `FADESTER_MAC_OBS_PASSWORD` privately. Then run:

```sh
node --import tsx scripts/macos/live-suite.ts io.github.jbrick2070.fadester-for-obs.sdPlugin
```

`FADESTER_MAC_MIX=1` opts into whole-mix tests. The provider must report enabled, inactive, not fading and 0 dB. The OBS input list must contain **only this run's generated inputs**, including no global desktop/microphone devices; the harness will not remove or disable existing inputs to satisfy this requirement. Without this opt-in, mix is explicitly skipped.

For the existing rental-Mac fixture only, `FADESTER_MAC_MIX_ALLOW_COLOR_FIXTURE=1` additionally allows the preexisting **Color** input with UUID `3be2aa1c-48e3-4d4d-8bd3-898664a6e1cc`, kind `color_source_v3`, and exact numeric capabilities `32777` (video/custom drawing/sRGB, no audio or composite flags). This requires `FADESTER_MAC_MIX=1`. Every write guard rechecks that exact identity and capabilities and rejects every other non-fixture input. Missing/renamed/replaced Color, unknown capabilities, or any audio/composite capability refuses the run. Color is never added to the owned cleanup plan and remains intact. This exception does not allow arbitrary color sources or authorize changes to existing inputs.

Generated scenes and inputs have a unique `Fadester Mac Test …` prefix and recorded UUIDs. A silent local WAV remains muted. The temporary suite has an independent SDK connection, in-memory settings and its own VJster loopback port. Existing Stream Deck profiles and the installed plugin are untouched.

On completion or a normal test error, the harness stops its own temporary process group and checks the complete cleanup plan before restoring Program/Preview/Studio Mode. All fixture names, UUIDs, scene-item identities and references across scenes/groups must still match. An added item, renamed/replaced input, external reference, or unexpected Program/Preview/Studio Mode change preserves the remaining fixtures. The complete remaining plan is checked again before each deletion; parent scenes must be empty. If an output starts, the connection fails or the collection changes, cleanup also fails closed and reports the unique prefix for manual review. A forced process kill or machine failure can leave fixtures; never treat their mere presence as passing results. Do not share the temporary plugin logs.

Only `GetReplayBufferStatus` error 604 is treated as an absent (inactive) replay output, matching OBS's own request handler. Every other output-query failure remains a refusal. A partial or unknown transition cursor also remains a refusal; reset it deliberately in the disposable OBS fixture before trying again. Accessibility writes alone do not guarantee that a manual transition has been released.

Cleanup explicitly detaches each recorded scene item before removing its input. OBS can keep a removed input alive while an inactive scene still references it; deleting the item releases that reference without bringing the fixture on screen. If the last item automatically destroys the input, cleanup verifies its absence and skips the redundant removal request. Renamed/replaced inputs and new references remain a refusal.

The pure guards are covered by `tests/macos-live-safety.test.ts`. A successful offline test is not a live acceptance result; this harness must itself be observed on the disposable Mac before its results are trusted.

## Verified optional whole-mix rehearsal — November 4, 2026

On the rented Apple Silicon Mac (macOS 27.2, OBS 33.0.1, Node 24.22.2), the combined
suite **0.10.0.0** passed this harness with both whole-mix gates enabled. The 34
safety tests passed first. Injected SDK scene, visibility, volume-dial and timed
fade events affected real OBS; VJster child rendering passed. The whole-mix
command received its correlated provider confirmation, and actual OBS gain was
verified and restored. This was an enabled, separately owned headless mix provider,
not the experimental Mac action host or its UI.

The wrapper started and stopped only that provider, kept credentials in Mac-local
process environment, and removed its private config/journal after success. The
harness removed only its generated fixtures. Independent inspection after provider
exit confirmed the original Program/Preview UUIDs, Studio Mode, unchanged existing
Color/settings/transforms, native T-bar zero, an idle renderer cursor after
settling, and streaming/recording/virtual camera/replay all inactive.

Artifact receipt: suite `bin/plugin.js` SHA-256
`efd42eef3ab550dc8a92c5351469fb5b8aebac0bc48bc75959d9fb87f6ae7db4`;
provider `FadesterMixHost` SHA-256
`2b06a35c86d60533a698138adcce5206d39815fa4305ae242fb67e950f6a90b9`.
The provider's adjacent project and eight shared production source files matched
the local sources byte for byte; this corroborates provenance but is not a
reproducible-build receipt. The harness source upload was hash-checked before use.

This proves the tested SDK client/provider/OBS path and cleanup with the exact
non-audio Color exception. The audio fixture was silent and muted: it does not
prove audible mixing, arbitrary real audio collections, physical controls, actual
Elgato-host event delivery, Chrome playback, credential persistence or a complete
Mac TourBox product. No native T-bar movement was performed by this harness.
