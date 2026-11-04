// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

interface MutationCheck {
  id: string;
  step: string;
  description: string;
  filePath: string;
  target: string;
  mutated: string;
  testFile: string;
}

const ROOT = resolve(process.cwd());

const MUTATIONS: MutationCheck[] = [
  {
    id: "M-3.1",
    step: "Cross-bank Clean FX eligibility",
    description: "Include nonfilter controls in Clean FX and verify the renderer rejects the wrong active count",
    filePath: resolve(ROOT, "packages/streamdeck-fadester-shared/src/fx-policy.ts"),
    target: 'slot.enabled !== false && slot.target_mode === "filter_param"',
    mutated: 'slot.enabled !== false && slot.target_mode !== "unassigned"',
    testFile: "tests/svg-renderer.test.ts"
  },
  {
    id: "M-3.2",
    step: "All FX custom labels",
    description: "Ignore the All FX label override and verify the saved label remains covered",
    filePath: resolve(ROOT, "packages/streamdeck-fadester-shared/src/svg-renderer.ts"),
    target: 'override || (activeCount > 0 ? t("cleanFxActiveTitle") : t("cleanFxIdleTitle"))',
    mutated: '(activeCount > 0 ? t("cleanFxActiveTitle") : t("cleanFxIdleTitle"))',
    testFile: "tests/svg-renderer.test.ts"
  },
  {
    id: "M-1.1",
    step: "Step 1.1 (Manifest & Bundle Hygiene)",
    description:
      "Mutate encoder Layouts path in manifest.json to a non-existent file and verify manifest-hygiene.test.ts fails",
    filePath: resolve(
      ROOT,
      "io.github.jbrick2070.fadester-for-obs.sdPlugin/manifest.json"
    ),
    target: '"layout": "layouts/fader-cell.json"',
    mutated: '"layout": "layouts/missing-cell.json"',
    testFile: "tests/manifest-hygiene.test.ts"
  },
  {
    id: "M-1.2a",
    step: "Step 1.2 (OBS Client Close 4009 Stop-Retry)",
    description:
      "Mutate close 4009 handler in obs-vendor-client.ts so wrong-password keeps retrying and verify fadester-client.test.ts fails",
    filePath: resolve(
      ROOT,
      "packages/streamdeck-fadester-shared/src/obs/obs-vendor-client.ts"
    ),
    target: "if (code === 4009) {",
    mutated: "if (code === 9999) {",
    testFile: "tests/fadester-client.test.ts"
  },
  {
    id: "M-1.2b",
    step: "Step 1.2 (OBS Client Post-Error get_state Resync)",
    description:
      "Disable post-error get_state() resync on inner vendor validation error in obs-vendor-client.ts and verify fadester-client.test.ts fails",
    filePath: resolve(
      ROOT,
      "packages/streamdeck-fadester-shared/src/obs/obs-vendor-client.ts"
    ),
    target:
      'if (resyncOnError && requestType !== "get_state" && this.identified) {\n        void this.getState().catch(() => {});\n      }\n      throw vendorErr;\n    }\n\n    return innerData as TResponse;',
    mutated:
      'if (false) {\n        void this.getState().catch(() => {});\n      }\n      throw vendorErr;\n    }\n\n    return innerData as TResponse;',
    testFile: "tests/fadester-client.test.ts"
  },
  {
    id: "M-1.3a",
    step: "Step 1.3 (SVG Renderer >= 3px Stroke Rule)",
    description:
      "Mutate dial status border stroke-width from 3 to 1 in svg-renderer.ts and verify svg-renderer.test.ts fails",
    filePath: resolve(
      ROOT,
      "packages/streamdeck-fadester-shared/src/svg-renderer.ts"
    ),
    target:
      '<rect x="2" y="2" width="196" height="96" rx="10" fill="url(#bg)" stroke="${borderColor}" stroke-width="3"/>',
    mutated:
      '<rect x="2" y="2" width="196" height="96" rx="10" fill="url(#bg)" stroke="${borderColor}" stroke-width="1"/>',
    testFile: "tests/svg-renderer.test.ts"
  },
  {
    id: "M-1.3b",
    step: "Step 1.3 (SVG Renderer Verbatim Unavailable Reason)",
    description:
      "Replace verbatim slot.reason with a generic string in svg-renderer.ts and verify svg-renderer.test.ts fails",
    filePath: resolve(
      ROOT,
      "packages/streamdeck-fadester-shared/src/svg-renderer.ts"
    ),
    target:
      'const unavailableReason =\n      slot.reason ||\n      (slot.target_mode === "unassigned"\n        ? t("cellUnassigned")\n        : t("cellUnavailableInObs"));',
    mutated: 'const unavailableReason = "Generic Error";',
    testFile: "tests/svg-renderer.test.ts"
  },
  {
    id: "M-1.3d",
    step: "Step 1.3 (0.3.0 Profile-Disabled Slot Reason Priority)",
    description:
      "Skip !slot.available branch when target_mode is unassigned in svg-renderer.ts so disabled slots swallow slot.reason, and verify svg-renderer.test.ts fails",
    filePath: resolve(
      ROOT,
      "packages/streamdeck-fadester-shared/src/svg-renderer.ts"
    ),
    target: "if (!slot.available) {",
    mutated: 'if (!slot.available && slot.target_mode !== "unassigned") {',
    testFile: "tests/svg-renderer.test.ts"
  },
  {
    id: "M-1.3c",
    step: "Step 1.3 (Per-Cell Rate Limiter Trailing-Edge Flush)",
    description:
      "Disable trailing-edge flush in cell-rate-limiter.ts and verify rate-limiter-thumbnails.test.ts fails",
    filePath: resolve(
      ROOT,
      "packages/streamdeck-fadester-shared/src/cell-rate-limiter.ts"
    ),
    target: "void this.onFlush(toSend);",
    mutated: "void toSend;",
    testFile: "tests/rate-limiter-thumbnails.test.ts"
  },
  {
    id: "M-1.4a",
    step: "Step 1.4 (Dial Press Nearest-Rail Comparison)",
    description:
      "Invert < 0.5 nearest-rail comparison in dial-math.ts and verify dial-math.test.ts fails",
    filePath: resolve(ROOT, "src/actions/dial-math.ts"),
    target: "const targetRail = currentValue < 0.5 ? 1.0 : 0.0;",
    mutated: "const targetRail = currentValue > 0.5 ? 1.0 : 0.0;",
    testFile: "tests/dial-math.test.ts"
  },
  {
    id: "M-1.4b",
    step: "Step 1.4 (Dial 800 ms Hold Indicator Overlay)",
    description:
      "Omit setting holdingForLongPress = true on dialDown in fader-dial.ts and verify actions-integration.test.ts fails",
    filePath: resolve(ROOT, "src/actions/fader-dial.ts"),
    target: "this.holdingForLongPress = true;",
    mutated: "this.holdingForLongPress = false;",
    testFile: "tests/actions-integration.test.ts"
  },
  {
    id: "M-1.4c",
    step: "Step 1.4 (All-FX Auto-fade Key Dispatch)",
    description:
      "Disable the __all_fx__ reset branch and verify actions-integration.test.ts fails",
    filePath: resolve(ROOT, "src/actions/auto-fade-key.ts"),
    target: "if (this.settings.slot === ALL_FX_SLOT_ID) {",
    mutated: "if (false) {",
    testFile: "tests/actions-integration.test.ts"
  },
  {
    id: "M-1.4d",
    step: "Step 1.4 (Zero-Duration Auto-fade Key Release)",
    description:
      "Disable the zero-duration release branch and verify actions-integration.test.ts fails",
    filePath: resolve(ROOT, "src/actions/auto-fade-key.ts"),
    target: "if (this.settings.durationMs === 0) {",
    mutated: "if (false) {",
    testFile: "tests/actions-integration.test.ts"
  },
  {
    id: "M-2.1a",
    step: "Step 2.1 (PI Bridge Never Echoes the Password)",
    description:
      "Leak the stored password into the PI state payload and verify pi-bridge.test.ts fails",
    filePath: resolve(ROOT, "src/pi/pi-bridge.ts"),
    target: "passwordSet: settings.password.length > 0",
    mutated:
      "passwordSet: settings.password.length > 0, password: settings.password",
    testFile: "tests/pi-bridge.test.ts"
  },
  {
    id: "M-2.1b",
    step: "Step 2.1 (Change-Only Reconnect on Settings Save)",
    description:
      "Force updateSettings() to reconnect even when nothing changed and verify pi-bridge.test.ts fails",
    filePath: resolve(
      ROOT,
      "packages/streamdeck-fadester-shared/src/obs/obs-vendor-client.ts"
    ),
    target: "if (changed && !this.stopped) {",
    mutated: "if (!this.stopped) {",
    testFile: "tests/pi-bridge.test.ts"
  },
  {
    id: "M-2.2a",
    step: "Step 2.2 (Unavailable Slot Guard)",
    description:
      "Skip the slot.available guard in fader-dial.ts so requests reach OBS for unavailable slots and verify action-guards.test.ts fails",
    filePath: resolve(ROOT, "src/actions/fader-dial.ts"),
    target: "if (slot && !slot.available) {",
    mutated: "if (false) {",
    testFile: "tests/action-guards.test.ts"
  },
  {
    id: "M-2.2b",
    step: "Step 2.2 (Throttled Offline Reconnect Nudge)",
    description:
      "Remove the 2 s throttle in nudgeReconnect() and verify action-guards.test.ts fails",
    filePath: resolve(
      ROOT,
      "packages/streamdeck-fadester-shared/src/obs/obs-vendor-client.ts"
    ),
    target: "if (now - this.lastNudgeAt < minIntervalMs) {",
    mutated: "if (false) {",
    testFile: "tests/action-guards.test.ts"
  },
  {
    id: "M-8.1a",
    step: "Step 8.1 (Translations: lookup bypass)",
    description:
      "Return the English text without consulting the active language and verify i18n-strings.test.ts fails",
    filePath: resolve(ROOT, "src/i18n/strings.ts"),
    target: "return fillTemplate(lookupText(activeTable, key), params);",
    mutated: "return fillTemplate(EN[key], params);",
    testFile: "tests/i18n-strings.test.ts"
  },
  {
    id: "M-8.1b",
    step: "Step 8.1 (Translations: status changes by parameters)",
    description:
      "Compare only the status kind, so a version change no longer emits statusChanged, and verify i18n-strings.test.ts fails",
    filePath: resolve(
      ROOT,
      "packages/streamdeck-fadester-shared/src/obs/obs-vendor-client.ts"
    ),
    target: "const changed = statusSignature(this.status) !== statusSignature(next);",
    mutated: "const changed = this.status.kind !== next.kind;",
    testFile: "tests/i18n-strings.test.ts"
  },
  {
    id: "M-8.2a",
    step: "Step 8.2 (Translations: stored English captions drawn translated)",
    description:
      "Draw every stored caption as typed, so a bundled profile's English caption reaches a German deck, and verify preset-captions.test.ts fails",
    filePath: resolve(ROOT, "src/obs/preset-captions.ts"),
    target: 'return caption && !isGeneratedCaption(action, settings, caption) ? caption : "";',
    mutated: "return caption;",
    testFile: "tests/preset-captions.test.ts"
  },
  {
    id: "M-8.3a",
    step: "Step 8.3 (Translations: CJK width)",
    description:
      "Count CJK, kana and Hangul at a Latin letter's width and verify deck-fit.test.ts fails",
    filePath: resolve(ROOT, "packages/streamdeck-fadester-shared/src/text-fit.ts"),
    target: "if (WIDE.test(ch)) return 1;",
    mutated: "if (WIDE.test(ch)) return 0.6;",
    testFile: "tests/deck-fit.test.ts"
  },
  {
    id: "M-8.3b",
    step: "Step 8.3 (Translations: shorten by width)",
    description:
      "Never shorten a text that is too wide for its box and verify deck-fit.test.ts fails",
    filePath: resolve(ROOT, "packages/streamdeck-fadester-shared/src/text-fit.ts"),
    target: "  if (fitsBox(text, fontSize, maxWidth)) return text;",
    mutated: "  if (text.length > 0) return text;",
    testFile: "tests/deck-fit.test.ts"
  },
  {
    id: "M-8.4a",
    step: "Step 8.4 (Translations: Stream Deck's language at start)",
    description:
      "Ignore Stream Deck's language and always start in English, and verify i18n-strings.test.ts fails",
    filePath: resolve(ROOT, "src/i18n/load.ts"),
    target: "  if (exact) return exact;",
    mutated: '  if (exact) return "en";',
    testFile: "tests/i18n-strings.test.ts"
  },
  {
    id: "M-8.5a",
    step: "Step 8.5 (Translations: inspectors follow the language)",
    description:
      "Keep the inspectors in English whatever the language, and verify inspector-i18n.test.ts fails",
    filePath: resolve(ROOT, "io.github.jbrick2070.fadester-for-obs.sdPlugin/ui/i18n.js"),
    target: "active = TABLES[language] || EN;",
    mutated: "active = EN;",
    testFile: "tests/inspector-i18n.test.ts"
  },
  {
    id: "M-9.1a",
    step: "Step 9.1 (Playlister transport: the fake's media status)",
    description:
      "Send a numeric cursor and duration in STOPPED, where the protocol sends null, and verify fake-obs-server.test.ts fails",
    filePath: resolve(ROOT, "tests/helpers/fake-obs-server.ts"),
    target: 'const showsTime = mediaState === "OBS_MEDIA_STATE_PLAYING" || mediaState === "OBS_MEDIA_STATE_PAUSED";',
    mutated: 'const showsTime = mediaState === "OBS_MEDIA_STATE_PLAYING" || mediaState === "OBS_MEDIA_STATE_PAUSED" || mediaState === "OBS_MEDIA_STATE_STOPPED";',
    testFile: "tests/fake-obs-server.test.ts"
  },
  {
    id: "M-9.1b",
    step: "Step 9.1 (Playlister transport: the fake's PAUSE rule)",
    description:
      "Let PAUSE in STOPPED produce PAUSED, which the native source ignores, and verify fake-obs-server.test.ts fails",
    filePath: resolve(ROOT, "tests/helpers/fake-obs-server.ts"),
    target: 'if (media.state === "OBS_MEDIA_STATE_PLAYING") media.state = "OBS_MEDIA_STATE_PAUSED";',
    mutated: 'if (media.state !== "OBS_MEDIA_STATE_NONE") media.state = "OBS_MEDIA_STATE_PAUSED";',
    testFile: "tests/fake-obs-server.test.ts"
  },
  {
    id: "M-9.2a",
    step: "Step 9.2 (Playlister transport: four presses per Playlister)",
    description:
      "Remove the four-entry bound so a fifth press queues, and verify playlister-media.test.ts fails",
    filePath: resolve(ROOT, "src/obs/direct-obs-client.ts"),
    target: 'if (target.queue.length >= MEDIA_QUEUE_LIMIT) throw new DirectObsError(ownText("errorMediaBusy"), 400);',
    mutated: 'if (false) throw new DirectObsError(ownText("errorMediaBusy"), 400);',
    testFile: "tests/playlister-media.test.ts"
  },
  {
    id: "M-9.2b",
    step: "Step 9.2 (Playlister transport: Stop purges first)",
    description:
      "Let Stop skip the purge of that Playlister's unsent presses, and verify playlister-media.test.ts fails",
    filePath: resolve(ROOT, "src/obs/direct-obs-client.ts"),
    target: 'if (op === "stop") this.purgeMediaQueue(target);',
    mutated: "if (false) this.purgeMediaQueue(target);",
    testFile: "tests/playlister-media.test.ts"
  },
  {
    id: "M-9.2c",
    step: "Step 9.2 (Playlister transport: late replies)",
    description:
      "Let a status reply of an old generation overwrite the state after a collection change, and verify playlister-media.test.ts fails",
    filePath: resolve(ROOT, "src/obs/direct-obs-client.ts"),
    target: "if (generation === this.mediaGeneration && sequence > target.lastAppliedSequence) {",
    mutated: "if (sequence > target.lastAppliedSequence) {",
    testFile: "tests/playlister-media.test.ts"
  },
  {
    id: "M-9.2d",
    step: "Step 9.2 (Playlister transport: no retry)",
    description:
      "Retry a failed NEXT once, and verify playlister-media.test.ts fails",
    filePath: resolve(ROOT, "src/obs/direct-obs-client.ts"),
    target: "      if (target.pendingStamp === stamp) this.clearMediaPending(target);\n      this.emitMediaState(target);\n      throw error;",
    mutated: '      if (target.pendingStamp === stamp) this.clearMediaPending(target);\n      this.emitMediaState(target);\n      if (entry.op === "next") { await this.sendObsRequest("TriggerMediaInputAction", { inputUuid: target.uuid, mediaAction: OBS_MEDIA_ACTIONS[action] }); return "sent"; }\n      throw error;',
    testFile: "tests/playlister-media.test.ts"
  },
  {
    id: "M-9.2e",
    step: "Step 9.2 (Playlister transport: polls only while watched)",
    description:
      "Start the poll of a target that has no watcher on a catalog publication, and verify playlister-media.test.ts fails",
    filePath: resolve(ROOT, "src/obs/direct-obs-client.ts"),
    target: "    } else if (target.watchers > 0) {\n      this.startMediaPoll(target);",
    mutated: "    } else {\n      this.startMediaPoll(target);",
    testFile: "tests/playlister-media.test.ts"
  },
  {
    id: "M-9.2f",
    step: "Step 9.2 (Playlister transport: InputRemoved by UUID)",
    description:
      "Match InputRemoved by inputName again, and verify playlister-media.test.ts fails",
    filePath: resolve(ROOT, "src/obs/direct-obs-client.ts"),
    target: 'const removedUuid = typeof eventData.inputUuid === "string" ? eventData.inputUuid : "";',
    mutated: 'const removedUuid = this.catalog.inputDetails.find((input) => input.inputName === eventData.inputName)?.inputUuid ?? "";',
    testFile: "tests/playlister-media.test.ts"
  },
  {
    id: "M-9.2g",
    step: "Step 9.2 (Playlister transport: status reads by inputUuid)",
    description:
      "Send the status read by inputName instead of inputUuid (the fake answers both), and verify playlister-media.test.ts fails",
    filePath: resolve(ROOT, "src/obs/direct-obs-client.ts"),
    target: 'const data = await this.sendObsRequest("GetMediaInputStatus", { inputUuid: target.uuid });',
    mutated: 'const data = await this.sendObsRequest("GetMediaInputStatus", { inputName: this.mediaInputName(target.uuid) });',
    testFile: "tests/playlister-media.test.ts"
  },
  {
    id: "M-9.2h",
    step: "Step 9.2 (Playlister transport: no status read for a removed Playlister)",
    description:
      "Send a status read whatever the target's availability, so a command's trailing read reaches a removed UUID, and verify playlister-media.test.ts fails",
    filePath: resolve(ROOT, "src/obs/direct-obs-client.ts"),
    target: '    if (availability !== "ok") throw this.mediaAvailabilityError(availability, target.uuid);',
    mutated: "    if (false) throw this.mediaAvailabilityError(availability, target.uuid);",
    testFile: "tests/playlister-media.test.ts"
  },
  {
    id: "M-9.2i",
    step: "Step 9.2 (Playlister transport: a reply after InputRemoved is dropped)",
    description:
      "Apply a status reply that lands after the Playlister left OBS, and verify playlister-media.test.ts fails",
    filePath: resolve(ROOT, "src/obs/direct-obs-client.ts"),
    target: 'if (this.mediaAvailability(target.uuid) !== "ok") return reply;',
    mutated: "if (false) return reply;",
    testFile: "tests/playlister-media.test.ts"
  },
  {
    id: "M-9.2j",
    step: "Step 9.2 (Playlister transport: the pending-PAUSE NONE exemption)",
    description:
      "Let NONE settle a pending PAUSE inside the window after a load of ours, and verify playlister-media.test.ts fails",
    filePath: resolve(ROOT, "src/obs/direct-obs-client.ts"),
    target: '(reply.state === "none" && Date.now() - target.loadSentAt > MEDIA_LOAD_WINDOW_MS)',
    mutated: 'reply.state === "none"',
    testFile: "tests/playlister-media.test.ts"
  },
  {
    id: "M-9.2k",
    step: "Step 9.2 (Playlister transport: a load opens the transient-NONE window)",
    description:
      "Record no load time for Next, Previous, Restart or Play, so the transient NONE after a load settles a pending PAUSE, and verify playlister-media.test.ts fails",
    filePath: resolve(ROOT, "src/obs/direct-obs-client.ts"),
    target: 'if (action !== "pause" && action !== "stop") target.loadSentAt = Date.now();',
    mutated: "if (false) target.loadSentAt = Date.now();",
    testFile: "tests/playlister-media.test.ts"
  },
  {
    id: "M-9.2l",
    step: "Step 9.2 (Playlister transport: a toggle refused by a removal is cancelled)",
    description:
      "Reject a toggle whose in-queue read was refused because its Playlister left OBS, instead of cancelling it quietly, and verify playlister-media.test.ts fails",
    filePath: resolve(ROOT, "src/obs/direct-obs-client.ts"),
    target: '        // Invalidated, or the input left before its read went out: nothing was sent.\n        if (generation !== this.mediaGeneration || this.mediaAvailability(target.uuid) !== "ok") return "cancelled";',
    mutated: '        // Invalidated, or the input left before its read went out: nothing was sent.\n        if (generation !== this.mediaGeneration) return "cancelled";',
    testFile: "tests/playlister-media.test.ts"
  },
  {
    id: "M-9.3a",
    step: "Step 9.3 (Playlister transport key: nothing sent when unbound)",
    description:
      "Let an unbound key reach the client's command, and verify playlister-transport.test.ts fails",
    filePath: resolve(ROOT, "src/actions/playlister-transport-key.ts"),
    target: "    if (!this.settings.inputUuid) {\n      await this.sink.showAlert();\n      return;\n    }",
    mutated: "    if (false) {\n      await this.sink.showAlert();\n      return;\n    }",
    testFile: "tests/playlister-transport.test.ts"
  },
  {
    id: "M-9.3b",
    step: "Step 9.3 (Playlister transport key: the observed state word)",
    description:
      "Draw a fixed Playing instead of the observed state, and verify playlister-transport.test.ts fails",
    filePath: resolve(ROOT, "src/actions/playlister-transport-key.ts"),
    target: "const word = t(STATE_WORDS[state.mediaState]);",
    mutated: 'const word = t("mediaStatePlaying");',
    testFile: "tests/playlister-transport.test.ts"
  },
  {
    id: "M-9.4a",
    step: "Step 9.4 (Playlister transport inspector: Playlister sources only)",
    description:
      "List every input kind in the Playlister picker, and verify playlister-inspector.test.ts fails",
    filePath: resolve(ROOT, "io.github.jbrick2070.fadester-for-obs.sdPlugin/ui/playlister-transport-key.html"),
    target: 'return (input.unversionedInputKind || String(input.inputKind || "").replace(/_v\\d+$/, "")) === "obs_playlister_source";',
    mutated: "return true;",
    testFile: "tests/playlister-inspector.test.ts"
  },
  {
    id: "M-9.6a",
    step: "Step 9.6 (Playlister transport texts: the state word follows the language)",
    description:
      "Draw the English state word whatever the language (the key name without its prefix), and verify playlister-transport.test.ts fails on the German deck",
    filePath: resolve(ROOT, "src/actions/playlister-transport-key.ts"),
    target: "const word = t(STATE_WORDS[state.mediaState]);",
    mutated: 'const word = String(STATE_WORDS[state.mediaState]).replace("mediaState", "");',
    testFile: "tests/playlister-transport.test.ts"
  },
  {
    id: "M-10.1a",
    step: "Step 10.1 (filter writes are overlays)",
    description:
      "Send SetSourceFilterSettings with overlay false (every other setting returns to its default), and verify filter-requests.test.ts fails",
    filePath: resolve(ROOT, "src/obs/direct-obs-client.ts"),
    target: 'await this.sendObsRequest("SetSourceFilterSettings", { sourceUuid, filterName, filterSettings: { ...filterSettings }, overlay: true });',
    mutated: 'await this.sendObsRequest("SetSourceFilterSettings", { sourceUuid, filterName, filterSettings: { ...filterSettings }, overlay: false });',
    testFile: "tests/filter-requests.test.ts"
  },
  {
    id: "M-10.1b",
    step: "Step 10.1 (filters are addressed by the source's UUID)",
    description:
      "Address GetSourceFilter by sourceName, and verify filter-requests.test.ts fails",
    filePath: resolve(ROOT, "src/obs/direct-obs-client.ts"),
    target: 'const data = await this.sendObsRequest("GetSourceFilter", { sourceUuid, filterName });',
    mutated: 'const data = await this.sendObsRequest("GetSourceFilter", { sourceName: sourceUuid, filterName });',
    testFile: "tests/filter-requests.test.ts"
  },
  {
    id: "M-10.2a",
    step: "Step 10.2 (filter writes: the slew cap)",
    description:
      "Let one write move a setting any distance, and verify filter-controller.test.ts fails",
    filePath: resolve(ROOT, "src/control/filter-controller.ts"),
    target: "const limit = slewStep(range, this.slewFraction);",
    mutated: "const limit = Number.POSITIVE_INFINITY;",
    testFile: "tests/filter-controller.test.ts"
  },
  {
    id: "M-10.2b",
    step: "Step 10.2 (filter writes: one in flight per filter)",
    description:
      "Let a second write go out while one is in flight, and verify filter-controller.test.ts fails",
    filePath: resolve(ROOT, "src/control/filter-controller.ts"),
    target: "    if (record.inFlight) return;",
    mutated: "    if (false) return;",
    testFile: "tests/filter-controller.test.ts"
  },
  {
    id: "M-10.2c",
    step: "Step 10.2 (a gesture starts from a fresh read)",
    description:
      "Skip the gesture's fresh read and ride the cached value, and verify filter-controller.test.ts fails",
    filePath: resolve(ROOT, "src/control/filter-controller.ts"),
    target: "          await this.readFilter(record, generation);\n          await this.readOwnership(record, target.setting, generation);\n          this.requireReady(record, target, generation);\n          const value = record.values[target.setting] as number;\n          created.wanted",
    mutated: "          await this.readOwnership(record, target.setting, generation);\n          this.requireReady(record, target, generation);\n          const value = record.values[target.setting] as number;\n          created.wanted",
    testFile: "tests/filter-controller.test.ts"
  },
  {
    id: "M-10.2d",
    step: "Step 10.2 (the deck's deny list)",
    description:
      "Let max_flash_rate_hz be written from the deck, and verify filter-controller.test.ts fails",
    filePath: resolve(ROOT, "src/obs/filter-ranges.ts"),
    target: "\"preset_shader\", \"shader_file_path\", \"shader_text\", \"override_entire_effect\", \"max_flash_rate_hz\",",
    mutated: "\"preset_shader\", \"shader_file_path\", \"shader_text\", \"override_entire_effect\",",
    testFile: "tests/filter-controller.test.ts"
  },
  {
    id: "M-10.2e",
    step: "Step 10.2 (ownership refuses a driven setting)",
    description:
      "Ignore who else drives a setting, and verify filter-controller.test.ts fails",
    filePath: resolve(ROOT, "src/control/filter-controller.ts"),
    target: "    const owner = record.owners.get(target.setting);\n    if (owner) throw",
    mutated: "    const owner = null;\n    if (owner) throw",
    testFile: "tests/filter-controller.test.ts"
  },
  {
    id: "M-10.2f",
    step: "Step 10.2 (lifecycle generation)",
    description:
      "Keep the generation across a collection change or reconnect, and verify filter-controller.test.ts fails",
    filePath: resolve(ROOT, "src/control/filter-controller.ts"),
    target: "    this.generation++;",
    mutated: "    this.generation += 0;",
    testFile: "tests/filter-controller.test.ts"
  },
  {
    id: "M-10.2g",
    step: "Step 10.2 (merged per filter, not per setting)",
    description:
      "Let the newest value of one setting drop another setting's pending value, and verify filter-controller.test.ts fails",
    filePath: resolve(ROOT, "src/control/filter-controller.ts"),
    target: "    record.pending.set(setting, writableValue(value, range));",
    mutated: "    record.pending.clear();\n    record.pending.set(setting, writableValue(value, range));",
    testFile: "tests/filter-controller.test.ts"
  },
  {
    id: "M-10.2h",
    step: "Step 10.2 (sibling modulators re-read at every gesture)",
    description:
      "Skip the gesture's ownership re-read, and verify filter-controller.test.ts fails",
    filePath: resolve(ROOT, "src/control/filter-controller.ts"),
    target: "          await this.readOwnership(record, target.setting, generation);\n          this.requireReady(record, target, generation);\n          const value = record.values[target.setting] as number;\n          created.wanted",
    mutated: "          this.requireReady(record, target, generation);\n          const value = record.values[target.setting] as number;\n          created.wanted",
    testFile: "tests/filter-controller.test.ts"
  },
  {
    id: "M-10.2i",
    step: "Step 10.2 (filterKind in the identity)",
    description:
      "Accept a read of another filter kind, and verify filter-controller.test.ts fails",
    filePath: resolve(ROOT, "src/control/filter-controller.ts"),
    target: "    if (info.filterKind !== record.filterKind) {\n      record.read = \"wrong_kind\";",
    mutated: "    if (false) {\n      record.read = \"wrong_kind\";",
    testFile: "tests/filter-controller.test.ts"
  },
  {
    id: "M-10.2j",
    step: "Step 10.2 (an Audio Modulator is written at most five times a second)",
    description:
      "Write an Audio Modulator as often as any filter, and verify filter-controller.test.ts fails",
    filePath: resolve(ROOT, "src/control/filter-controller.ts"),
    target: "return record.filterKind === VS_MODULATOR_FILTER_KIND ? this.modulatorWriteIntervalMs : this.writeIntervalMs;",
    mutated: "return this.writeIntervalMs;",
    testFile: "tests/filter-controller.test.ts"
  },
  {
    id: "M-10.2k",
    step: "Step 10.2 (at most 20 writes a second over all filters)",
    description:
      "Drop the global write cap, and verify filter-controller.test.ts fails",
    filePath: resolve(ROOT, "src/control/filter-controller.ts"),
    target: "this.globalNextWriteAt = now + this.globalIntervalMs;",
    mutated: "this.globalNextWriteAt = now;",
    testFile: "tests/filter-controller.test.ts"
  },
  {
    id: "M-10.3a",
    step: "Step 10.3 (Restore needs the 800 ms hold)",
    description:
      "Send Restore on a short press, and verify visual-panic.test.ts fails",
    filePath: resolve(ROOT, "src/actions/visual-panic-key.ts"),
    target: "    }, this.holdMs);",
    mutated: "    }, 0);",
    testFile: "tests/visual-panic.test.ts"
  },
  {
    id: "M-10.3b",
    step: "Step 10.3 (the latch clears on a reconnect)",
    description:
      "Keep the latch across a reconnect, and verify visual-panic.test.ts fails",
    filePath: resolve(ROOT, "src/control/visual-safety.ts"),
    target: '      this.setLatched(false);\n      this.emit("reset");',
    mutated: '      this.emit("reset");',
    testFile: "tests/visual-panic.test.ts"
  },
  {
    id: "M-10.3c",
    step: "Step 10.3 (every Panic press sends, also while latched)",
    description:
      "Swallow a Panic press while the latch is set (a press gated on the latch, not a timed debounce), and verify visual-panic.test.ts fails",
    filePath: resolve(ROOT, "src/control/visual-safety.ts"),
    target: "    this.setLatched(true);",
    mutated: "    if (this.latched) return;\n    this.setLatched(true);",
    testFile: "tests/visual-panic.test.ts"
  },
  {
    id: "M-10.4a",
    step: "Step 10.4 (a Look key toggles from a fresh read)",
    description:
      "Toggle a filter from the controller's cached state, and verify obs-filter-control.test.ts fails",
    filePath: resolve(ROOT, "src/control/filter-controller.ts"),
    target: "    const record = this.recordFor(target);\n    await this.readFilter(record, generation);\n    this.requireReady(record, { ...target, setting: \"\" }, generation);",
    mutated: "    const record = this.recordFor(target);\n    if (record.read !== \"ok\") await this.readFilter(record, generation);\n    this.requireReady(record, { ...target, setting: \"\" }, generation);",
    testFile: "tests/obs-filter-control.test.ts"
  },
  {
    id: "M-10.4b",
    step: "Step 10.4 (the default accent draws today's look)",
    description:
      "Draw the default accent in brass, and verify obs-filter-control.test.ts fails",
    filePath: resolve(ROOT, "src/gfx/direct-obs-renderer.ts"),
    target: "  default: P.accentPurple,",
    mutated: '  default: "#F5B841",',
    testFile: "tests/obs-filter-control.test.ts"
  },
  {
    id: "M-10.5a",
    step: "Step 10.5 (the inspector never lists a setting the deck does not write)",
    description:
      "List denied settings (max_flash_rate_hz, thresholds, colours, fader slots) in the inspector, and verify obs-filter-inspector.test.ts fails",
    filePath: resolve(ROOT, "src/pi/direct-obs-bridge.ts"),
    target: "!table.includes(setting) && !isDeniedForFilter(filter.filterKind, setting, merged) &&",
    mutated: "!table.includes(setting) &&",
    testFile: "tests/obs-filter-inspector.test.ts"
  },
  {
    id: "M-10.6a",
    step: "Step 10.6 (Panic on its key on every page)",
    description:
      "Let a rig page without Panic pass the build's check, and verify vj-rig-profiles.test.ts fails",
    filePath: resolve(ROOT, "scripts/profile-checks.ts"),
    target: 'if (!panic || panic.kind !== "panic" || (panic.settings.operation ?? "panic") !== "panic") {',
    mutated: "if (false) {",
    testFile: "tests/vj-rig-profiles.test.ts"
  },
  {
    id: "M-10.6b",
    step: "Step 10.6 (the multi-page writer)",
    description:
      "Write only a preset's first page, and verify vj-rig-profiles.test.ts fails",
    filePath: resolve(ROOT, "scripts/profile-checks.ts"),
    target: "  const pages = presetPages(preset);\n  const multi = pages.length > 1;",
    mutated: "  const pages = presetPages(preset).slice(0, 1);\n  const multi = pages.length > 1;",
    testFile: "tests/vj-rig-profiles.test.ts"
  },
  {
    id: "M-10.9a",
    step: "Review fixes (a live value outside the range is refused, never pulled to the edge)",
    description:
      "Let a gesture start from a value outside the range, and verify filter-controller.test.ts fails",
    filePath: resolve(ROOT, "src/control/filter-controller.ts"),
    target: "    if (resolved.ok && isOutsideRange(raw, resolved.range)) throw new DirectObsError(ownText(\"filterOutOfRange\"), 409);",
    mutated: "",
    testFile: "tests/filter-controller.test.ts"
  },
  {
    id: "M-10.9b",
    step: "Review fixes (the Panic latch is set before OBS answers)",
    description:
      "Set the latch only after OBS answered the Panic, and verify visual-panic.test.ts fails",
    filePath: resolve(ROOT, "src/control/visual-safety.ts"),
    target: "    this.setLatched(true);\n    try {\n      await this.client.triggerHotkeyByName(VS_PANIC_HOTKEY);",
    mutated: "    try {\n      await this.client.triggerHotkeyByName(VS_PANIC_HOTKEY);\n      this.setLatched(true);",
    testFile: "tests/visual-panic.test.ts"
  },
  {
    id: "M-10.9d",
    step: "Review fixes (a latched toggle is refused before any read)",
    description:
      "Drop the toggle's latch check before its read, and verify filter-controller.test.ts fails",
    filePath: resolve(ROOT, "src/control/filter-controller.ts"),
    target: "    this.requireBound(target);\n    if (this.panicLatched && isVisualSidechainKind(target.filterKind)) throw new DirectObsError(ownText(\"filterLatched\"), 409);\n    const generation = this.generation;",
    mutated: "    this.requireBound(target);\n    const generation = this.generation;",
    testFile: "tests/filter-controller.test.ts"
  },
  {
    id: "M-10.9e",
    step: "Review fixes (a latched setting is refused before any read)",
    description:
      "Drop requireWritable's latch check, and verify filter-controller.test.ts fails",
    filePath: resolve(ROOT, "src/control/filter-controller.ts"),
    target: "    this.requireBound(target);\n    if (this.panicLatched && isVisualSidechainKind(target.filterKind)) throw new DirectObsError(ownText(\"filterLatched\"), 409);\n    const resolved = resolveRange(",
    mutated: "    this.requireBound(target);\n    const resolved = resolveRange(",
    testFile: "tests/filter-controller.test.ts"
  },
  {
    id: "M-10.9f",
    step: "Review fixes (a Panic or Restore answered 600 clears the latch)",
    description:
      "Keep the latch when OBS has no Visual Sidechain hotkey, and verify visual-panic.test.ts fails",
    filePath: resolve(ROOT, "src/control/visual-safety.ts"),
    target: "    if (this.panics === panics) this.setLatched(false);\n    return new DirectObsError(",
    mutated: "    return new DirectObsError(",
    testFile: "tests/visual-panic.test.ts"
  },
  {
    id: "M-10.9g",
    step: "Review fixes (a Restore answered after a newer Panic keeps that Panic's latch)",
    description:
      "Clear the latch on every accepted Restore, ignoring the Panics counter, and verify visual-panic.test.ts fails",
    filePath: resolve(ROOT, "src/control/visual-safety.ts"),
    target: "    if (this.panics === panics) this.setLatched(false);\n  }",
    mutated: "    this.setLatched(false);\n  }",
    testFile: "tests/visual-panic.test.ts"
  },
  {
    id: "M-10.9h",
    step: "Review fixes (a disabled Audio Modulator still owns what it targets)",
    description:
      "Let only an enabled modulator own a setting, and verify filter-controller.test.ts fails",
    filePath: resolve(ROOT, "src/obs/filter-ranges.ts"),
    target: "    if (filter.filterKind === VS_MODULATOR_FILTER_KIND && filter.filterName !== target.filterName) {",
    mutated: "    if (filter.filterKind === VS_MODULATOR_FILTER_KIND && filter.filterName !== target.filterName && filter.filterEnabled) {",
    testFile: "tests/filter-controller.test.ts"
  },
  {
    id: "M-10.9i",
    step: "Review fixes (cancel drops the setting's queued values)",
    description:
      "Keep a cancelled setting's queued values draining, and verify filter-controller.test.ts fails",
    filePath: resolve(ROOT, "src/control/filter-controller.ts"),
    target: "      record.pending.delete(target.setting);\n      record.ranges.delete(target.setting);",
    mutated: "      record.ranges.get(target.setting);",
    testFile: "tests/filter-controller.test.ts"
  },
  {
    id: "M-10.9j",
    step: "Review fixes (records keyed by bound kind)",
    description:
      "Key filter records by source and filter only, so a control of another kind shares (and refuses) the other's record, and verify filter-controller.test.ts fails",
    filePath: resolve(ROOT, "src/control/filter-controller.ts"),
    target: "  return `${filterKey(target.sourceUuid, target.filterName)}\\u0000${target.filterKind}`;",
    mutated: "  return `${filterKey(target.sourceUuid, target.filterName)}\\u0000`;",
    testFile: "tests/filter-controller.test.ts"
  },
  {
    id: "M-10.9k",
    step: "Review fixes (Panic needs only an identified socket)",
    description:
      "Gate Panic on the connected status (after the catalog read), and verify visual-panic.test.ts fails",
    filePath: resolve(ROOT, "src/actions/visual-panic-key.ts"),
    target: "      if (this.client.isIdentified()) {",
    mutated: "      if (this.client.isConnected()) {",
    testFile: "tests/visual-panic.test.ts"
  },
  {
    id: "M-10.9l",
    step: "Review fixes (a Scene key with no operation counts as a Transition beside Panic)",
    description:
      "Count a Scene & Transition key with no operation as a Preview, and verify vj-rig-profiles.test.ts fails",
    filePath: resolve(ROOT, "scripts/profile-checks.ts"),
    target: '  const operation = entry.settings.operation ?? "transition";',
    mutated: '  const operation = entry.settings.operation ?? "preview";',
    testFile: "tests/vj-rig-profiles.test.ts"
  },
  {
    id: "M-10.9m",
    step: "Review fixes (whole numbers stay inside the range)",
    description:
      "Round a whole-number value without keeping it inside the range's whole numbers, and verify filter-controller.test.ts fails",
    filePath: resolve(ROOT, "src/obs/filter-ranges.ts"),
    target: "  return Math.max(Math.ceil(range.min), Math.min(Math.floor(range.max), Math.round(clamped)));",
    mutated: "  return Math.round(clamped);",
    testFile: "tests/filter-controller.test.ts"
  },
  {
    id: "M-10.9n",
    step: "Review fixes (a shader's own list uniforms are denied)",
    description:
      "Ignore the list uniforms of a shader's text, and verify filter-controller.test.ts fails",
    filePath: resolve(ROOT, "src/obs/filter-ranges.ts"),
    target: "  return kind === VS_SHADER_FILTER_KIND && listUniformNames(settings.shader_text).has(setting);",
    mutated: "  return false;",
    testFile: "tests/filter-controller.test.ts"
  },
  {
    id: "M-10.9o",
    step: "Review fixes (several pages need the rig's keys named)",
    description:
      "Build a preset with several pages but no rig keys named (so the rig's rules never run), and verify vj-rig-profiles.test.ts fails",
    filePath: resolve(ROOT, "scripts/profile-checks.ts"),
    target: "  if (presetPages(preset).length > 1 && !preset.rig) {",
    mutated: "  if (false) {",
    testFile: "tests/vj-rig-profiles.test.ts"
  },
  {
    id: "M-10.7a",
    step: "Step 10.7 (the Panic words follow the deck's language)",
    description:
      "Draw the English Panic words whatever the language, and verify visual-panic.test.ts fails on the German deck",
    filePath: resolve(ROOT, "src/gfx/direct-obs-renderer.ts"),
    target: 'const title = input.title || t(latched ? "vpPanicSent" : "vpPanic");',
    mutated: 'const title = input.title || (latched ? "PANIC SENT" : "PANIC");',
    testFile: "tests/visual-panic.test.ts"
  },
  {
    id: "M-11.1a",
    step: "Step L.1 (the Language choice on the deck)",
    description:
      "Resolve every choice as Automatic (the stored choice ignored), and verify language-choice.test.ts fails",
    filePath: resolve(ROOT, "src/i18n/language-choice.ts"),
    target: 'return choice === "auto" ? normalizeLanguage(appLanguage) : choice;',
    mutated: "return normalizeLanguage(appLanguage);",
    testFile: "tests/language-choice.test.ts"
  },
  {
    id: "M-11.1b",
    step: "Step L.1 (the Language choice on the deck)",
    description:
      "Tell no control of a language change (no redraw), and verify language-choice.test.ts fails",
    filePath: resolve(ROOT, "src/i18n/strings.ts"),
    target: "for (const listener of [...languageListeners]) {",
    mutated: "for (const listener of [] as Array<(language: string) => void>) {",
    testFile: "tests/language-choice.test.ts"
  },
  {
    id: "M-11.1c",
    step: "Step L.1 (the Language choice on the deck)",
    description:
      "Write a save's own keys alone (a connection save drops the language and the rest), and verify language-choice.test.ts fails",
    filePath: resolve(ROOT, "src/settings/global-store.ts"),
    target: "const next = { ...this.current, ...change };",
    mutated: "const next = { ...change };",
    testFile: "tests/language-choice.test.ts"
  },
  {
    id: "M-11.1d",
    step: "Step L.1 (the Language choice on the deck)",
    description:
      "Leave the known settings as they were after the store's own write, and verify language-choice.test.ts fails",
    filePath: resolve(ROOT, "src/settings/global-store.ts"),
    target: "      this.current = next;\n",
    mutated: "",
    testFile: "tests/language-choice.test.ts"
  },
  {
    id: "M-11.1e",
    step: "Step L.1 (the Language choice on the deck)",
    description:
      "Skip the stored choice at start-up, and verify language-choice.test.ts fails",
    filePath: resolve(ROOT, "src/i18n/language-choice.ts"),
    target: "    await this.options.store.ready;\n    this.applyStored(this.options.store.snapshot().language);",
    mutated: "    await this.options.store.ready;",
    testFile: "tests/language-choice.test.ts"
  },
  {
    id: "M-11.1f",
    step: "Step L.1 (the Language choice on the deck)",
    description:
      "Save a setLanguageChoice pick without applying it, and verify language-choice.test.ts fails",
    filePath: resolve(ROOT, "src/i18n/language-choice.ts"),
    target: "    this.apply(choice);\n    this.options.broadcast();",
    mutated: "    this.options.broadcast();",
    testFile: "tests/language-choice.test.ts"
  },
  {
    id: "M-11.1g",
    step: "Step L.1 (the Language choice on the deck)",
    description:
      "Tell the controls on every setLanguage, the same code too (Automatic redraws), and verify language-choice.test.ts fails",
    filePath: resolve(ROOT, "src/i18n/strings.ts"),
    target: "if (activeLanguage === previous) return;",
    mutated: "if (false) return;",
    testFile: "tests/language-choice.test.ts"
  },
  {
    id: "M-11.1h",
    step: "Step L.1 (the Language choice on the deck)",
    description:
      "Keep saves waiting for the start-up read when Stream Deck sends the settings itself, and verify language-choice.test.ts fails",
    filePath: resolve(ROOT, "src/settings/global-store.ts"),
    target: "    this.current = { ...stored, ...held };\n    this.resolveReady();\n",
    mutated: "    this.current = { ...stored, ...held };\n",
    testFile: "tests/language-choice.test.ts"
  },
  {
    id: "M-11.1i",
    step: "Step L.1 (the Language choice on the deck)",
    description:
      "Let the start-up read hold the saves for good (no timeout), and verify language-choice.test.ts fails",
    filePath: resolve(ROOT, "src/settings/global-store.ts"),
    target: "await Promise.race([read, timedOut]);",
    mutated: "await read;",
    testFile: "tests/language-choice.test.ts"
  },
  {
    id: "M-11.1j",
    step: "Step L.1 (the Language choice on the deck)",
    description:
      "Let a late start-up read replace what the store wrote, and verify language-choice.test.ts fails",
    filePath: resolve(ROOT, "src/settings/global-store.ts"),
    target: "if (!this.known) this.learn(copyOf(stored));",
    mutated: "this.learn(copyOf(stored));",
    testFile: "tests/language-choice.test.ts"
  },
  {
    id: "M-11.1k",
    step: "Step L.1 (the Language choice on the deck)",
    description:
      "Save the pages' connections with a whole-object write in plugin.ts (the lost-key bug), and verify language-choice.test.ts fails",
    filePath: resolve(ROOT, "src/plugin.ts"),
    target: "const persistSharedConnection = connectionSaver(settingsStore, [enhancedClient, directClient]);",
    mutated:
      "const persistSharedConnection = async (settings: FadesterGlobalSettings): Promise<void> => {\n  await streamDeck.settings.setGlobalSettings(settings);\n  enhancedClient.updateSettings(settings);\n  directClient.updateSettings(settings);\n};",
    testFile: "tests/language-choice.test.ts"
  },
  {
    id: "M-11.1l",
    step: "Step L.1 (the Language choice on the deck)",
    description:
      "Write a save as the whole object while the start-up read has not answered (the write of only its own keys that erases host, port and password), and verify language-choice.test.ts fails",
    filePath: resolve(ROOT, "src/settings/global-store.ts"),
    target: "      if (!this.known) {\n        this.pending",
    mutated: "      if (false) {\n        this.pending",
    testFile: "tests/language-choice.test.ts"
  },
  {
    id: "M-11.1m",
    step: "Step L.1 (the Language choice on the deck)",
    description:
      "Let a held save overwrite the newer value Stream Deck sent while the read was out, and verify language-choice.test.ts fails",
    filePath: resolve(ROOT, "src/settings/global-store.ts"),
    target: "    if (this.pending) for (const key of Object.keys(next)) delete (this.pending as Record<string, unknown>)[key];\n",
    mutated: "",
    testFile: "tests/language-choice.test.ts"
  },
  {
    id: "M-11.1n",
    step: "Step L.1 (the Language choice on the deck)",
    description:
      "Drop a change whose write Stream Deck refused instead of holding it for the next write, and verify language-choice.test.ts fails",
    filePath: resolve(ROOT, "src/settings/global-store.ts"),
    target: "      this.pending = { ...change, ...this.pending };",
    mutated: "      this.pending = undefined;",
    testFile: "tests/language-choice.test.ts"
  },
  {
    id: "M-11.2a",
    step: "Step L.2 (the direct settings pages)",
    description: "Make the direct page ignore language.resolved (no refill), and verify direct-pi-language.test.ts fails",
    filePath: resolve(ROOT, "io.github.jbrick2070.fadester-for-obs.sdPlugin/ui/direct-pi.js"),
    target: "    if (!window.FadesterI18n.setResolved(language.resolved)) return;",
    mutated: "    return;",
    testFile: "tests/direct-pi-language.test.ts"
  },
  {
    id: "M-11.2b",
    step: "Step L.2 (the direct settings pages)",
    description: "Make the Language select send nothing on a change, and verify direct-pi-language.test.ts fails",
    filePath: resolve(ROOT, "io.github.jbrick2070.fadester-for-obs.sdPlugin/ui/direct-pi.js"),
    target: '      sendToPlugin({ event: "setLanguageChoice", choice: languagePicker.value });',
    mutated: "      void languagePicker;",
    testFile: "tests/direct-pi-language.test.ts"
  },
  {
    id: "M-11.2c",
    step: "Step L.2 (the direct settings pages)",
    description: "Set the Language select only when the resolved language changes, and verify direct-pi-language.test.ts fails",
    filePath: resolve(ROOT, "io.github.jbrick2070.fadester-for-obs.sdPlugin/ui/direct-pi.js"),
    target:
      '    if (picker) picker.value = known ? language.choice : "auto";',
    mutated:
      '    if (picker && language.resolved !== window.FadesterI18n.language()) picker.value = known ? language.choice : "auto";',
    testFile: "tests/direct-pi-language.test.ts"
  },
  {
    id: "M-11.2d",
    step: "Step L.2 (the direct settings pages)",
    description: "Paint a new page in Stream Deck's language, ignoring the remembered one, and verify direct-pi-language.test.ts fails",
    filePath: resolve(ROOT, "io.github.jbrick2070.fadester-for-obs.sdPlugin/ui/direct-pi.js"),
    target: "      if (!window.FadesterI18n.setResolved(recalledLanguage())) {",
    mutated: "      if (!window.FadesterI18n.setResolved(null)) {",
    testFile: "tests/direct-pi-language.test.ts"
  },
  {
    id: "M-11.2e",
    step: "Step L.2 (the direct settings pages)",
    description:
      "Let the pages' setResolved (generated ui/i18n.js) take any code through the Automatic mapping, so a stale remembered value is used, and verify direct-pi-language.test.ts fails",
    filePath: resolve(ROOT, "io.github.jbrick2070.fadester-for-obs.sdPlugin/ui/i18n.js"),
    target: '    return typeof code === "string" && PLUGIN_LANGUAGES.indexOf(code) !== -1 ? use(code) : null;',
    mutated: "    return use(normalize(code));",
    testFile: "tests/direct-pi-language.test.ts"
  },
  {
    id: "M-11.2f",
    step: "Step L.2 (the direct settings pages)",
    description: "Remember a resolved language the page refused (stale memory), and verify direct-pi-language.test.ts fails",
    filePath: resolve(ROOT, "io.github.jbrick2070.fadester-for-obs.sdPlugin/ui/direct-pi.js"),
    target: "    if (!window.FadesterI18n.setResolved(language.resolved)) return;\n    rememberLanguage(language.resolved);",
    mutated: "    rememberLanguage(language.resolved);\n    if (!window.FadesterI18n.setResolved(language.resolved)) return;",
    testFile: "tests/direct-pi-language.test.ts"
  },
  {
    id: "M-11.2g",
    step: "Step L.2 (the direct settings pages)",
    description: "Redraw only the connection after a state message (no refreshControls), so the pages' drawn texts stay in the old language, and verify direct-pi-language.test.ts fails",
    filePath: resolve(ROOT, "io.github.jbrick2070.fadester-for-obs.sdPlugin/ui/direct-pi.js"),
    target: "          updateLanguage(currentState.language);\n          updateConnection(currentState);\n          refreshControls();",
    mutated: "          updateLanguage(currentState.language);\n          updateConnection(currentState);",
    testFile: "tests/direct-pi-language.test.ts"
  },
  {
    id: "M-11.4a",
    step: "Step L.4 (Dutch strings)",
    description:
      "Take the present languages from Stream Deck's eight again (nl.json no longer checked), and verify i18n-strings.test.ts fails",
    filePath: resolve(ROOT, "tests/helpers/languages.ts"),
    target: "  return PLUGIN_LANGUAGES.filter((language) => existsSync(languageFilePath(language)));",
    mutated: "  return STREAM_DECK_LANGUAGES.filter((language) => existsSync(languageFilePath(language)));",
    testFile: "tests/i18n-strings.test.ts"
  },
  {
    id: "M-K1.1",
    step: "Demo kit step 1 (stock originals are checked by SHA-1)",
    description:
      "Skip the SHA-1 comparison and verify the changed-file test fails",
    filePath: resolve(ROOT, "demo-kit/build-kit.py"),
    target: "if actual_sha1 != row[\"sha1\"]:",
    mutated: "if False:",
    testFile: "tests/demo-kit-media.test.ts"
  },
  {
    id: "M-K1.2",
    step: "Demo kit step 1 (stock originals are checked by size)",
    description:
      "Skip the size comparison and verify the other-size test fails",
    filePath: resolve(ROOT, "demo-kit/build-kit.py"),
    target: "if actual_bytes != row[\"bytes\"]:",
    mutated: "if False:",
    testFile: "tests/demo-kit-media.test.ts"
  },
  {
    id: "M-K1.3",
    step: "Demo kit step 1 (a missing original is named)",
    description:
      "Skip the missing-file check and verify the missing-file test fails",
    filePath: resolve(ROOT, "demo-kit/build-kit.py"),
    target: "if not path.is_file():\n            problems.append(f\"{path.name}: file missing\")",
    mutated: "if False:\n            problems.append(f\"{path.name}: file missing\")",
    testFile: "tests/demo-kit-media.test.ts"
  },
  {
    id: "M-K1.4",
    step: "Demo kit step 1 (the stock check runs before any media is written)",
    description:
      "Make the media folder before the stock check and verify a refused build has written nothing",
    filePath: resolve(ROOT, "demo-kit/build-kit.py"),
    target: "rows = verify_stock(stock_dir, clips)  # before anything is written\n    media = out / \"media\"\n    media.mkdir(parents=True, exist_ok=True)",
    mutated: "media = out / \"media\"\n    media.mkdir(parents=True, exist_ok=True)\n    rows = verify_stock(stock_dir, clips)  # before anything is written",
    testFile: "tests/demo-kit-media.test.ts"
  },
  {
    id: "M-K1.5",
    step: "Demo kit step 1 (the sprint stays inside 0-8.9 s)",
    description:
      "Start the sprint at 1.0 s so its 8 s run past 8.9 s and verify the cut-limit test fails",
    filePath: resolve(ROOT, "demo-kit/build-kit.py"),
    target: "\"start\": 0.9, \"limit\": 8.9",
    mutated: "\"start\": 1.0, \"limit\": 8.9",
    testFile: "tests/demo-kit-media.test.ts"
  },
  {
    id: "M-K1.6",
    step: "Demo kit step 1 (three clips ship, the marathon is a spare)",
    description:
      "Ship the spare marathon and verify the shipped list is three clips",
    filePath: resolve(ROOT, "demo-kit/build-kit.py"),
    target: "\"start\": 4.0, \"limit\": 25.667, \"shipped\": False",
    mutated: "\"start\": 4.0, \"limit\": 25.667, \"shipped\": True",
    testFile: "tests/demo-kit-media.test.ts"
  },
  {
    id: "M-K1.7",
    step: "Demo kit step 1 (the stock excerpts' own audio is removed (D-6))",
    description:
      "Keep the clip's audio and verify the cut command test fails",
    filePath: resolve(ROOT, "demo-kit/build-kit.py"),
    target: "\"-frames:v\", str(CLIP_FRAMES), \"-an\", \"-sn\", \"-dn\",",
    mutated: "\"-frames:v\", str(CLIP_FRAMES), \"-sn\", \"-dn\",",
    testFile: "tests/demo-kit-media.test.ts"
  },
  {
    id: "M-K1.8",
    step: "Demo kit step 1 (the encoders run single-threaded so builds repeat byte for byte)",
    description:
      "Drop -threads 1 from x264 and verify the cut command test fails",
    filePath: resolve(ROOT, "demo-kit/build-kit.py"),
    target: "\"-c:v\", \"libx264\", \"-threads\", \"1\",",
    mutated: "\"-c:v\", \"libx264\",",
    testFile: "tests/demo-kit-media.test.ts"
  },
  // M-K1.9 and M-K1.10 (the generated loops' period and seam) went with the loops in kit 1.1 (K.6).
  {
    id: "M-K1.11",
    step: "Demo kit step 1 (the beat loops seamlessly)",
    description:
      "Drop the tails instead of folding them onto the start and verify the seamless-beat test fails",
    filePath: resolve(ROOT, "demo-kit/build-kit.py"),
    target: "loop[:len(tail)] += tail",
    mutated: "loop[:0] += tail[:0]",
    testFile: "tests/demo-kit-media.test.ts"
  },
  {
    id: "M-K1.12",
    step: "Demo kit step 1 (the media manifest holds no absolute paths)",
    description:
      "Accept an absolute path and verify the manifest test fails",
    filePath: resolve(ROOT, "demo-kit/build-kit.py"),
    target: "raise ValueError(f\"absolute path in manifest entry {entry['path']}\")",
    mutated: "pass",
    testFile: "tests/demo-kit-media.test.ts"
  },
  {
    id: "M-K1.13",
    step: "Demo kit step 1 (a failing stock cut reports ffmpeg's own message)",
    description:
      "Throw away ffmpeg's stderr when a cut fails and verify the failing-cut test fails",
    filePath: resolve(ROOT, "demo-kit/build-kit.py"),
    target: "result = subprocess.run(cut_command(source, start, output), capture_output=True)\n    if result.returncode:\n        raise RuntimeError(f\"ffmpeg failed for {output.name}: {result.stderr.decode(errors='replace')}\")",
    mutated: "result = subprocess.run(cut_command(source, start, output), capture_output=True)\n    if result.returncode:\n        raise RuntimeError(f\"ffmpeg failed for {output.name}\")",
    testFile: "tests/demo-kit-media.test.ts"
  },
  {
    id: "M-K1.14",
    step: "Demo kit step 1 (each video output is checked to be 1280x720)",
    description:
      "Skip the size check and verify the wrong-size check test fails",
    filePath: resolve(ROOT, "demo-kit/build-kit.py"),
    target: "if (v.get(\"width\"), v.get(\"height\")) != (W, H):",
    mutated: "if False:",
    testFile: "tests/demo-kit-media.test.ts"
  },
  {
    id: "M-K1.15",
    step: "Demo kit step 1 (each video output is checked to be 240 frames)",
    description:
      "Skip the frame-count check and verify the short-clip check test fails",
    filePath: resolve(ROOT, "demo-kit/build-kit.py"),
    target: "if str(v.get(\"nb_read_frames\")) != str(COUNT):",
    mutated: "if False:",
    testFile: "tests/demo-kit-media.test.ts"
  },
  {
    id: "M-K1.16",
    step: "Demo kit step 1 (the stock entries carry their shipped flag)",
    description:
      "Mark every stock excerpt as shipped and verify the manifest test sees the spare shipped",
    filePath: resolve(ROOT, "demo-kit/build-kit.py"),
    target: "\"kind\": \"stock\", \"shipped\": clip[\"shipped\"],",
    mutated: "\"kind\": \"stock\", \"shipped\": True,",
    testFile: "tests/demo-kit-media.test.ts"
  },
  {
    id: "M-K1.17",
    step: "Demo kit step 1 (files an earlier run left in media/ are named)",
    description:
      "Name no stray files and verify the stray-files test fails",
    filePath: resolve(ROOT, "demo-kit/build-kit.py"),
    target: "if p.is_file() and f\"media/{p.name}\" not in listed)",
    mutated: "if False)",
    testFile: "tests/demo-kit-media.test.ts"
  },
  {
    id: "M-K2.1",
    step: "Demo kit step 2 (collection UUIDs are v4-format)",
    description:
      "Leave the version nibble unset and verify the UUID tests fail",
    filePath: resolve(ROOT, "demo-kit/kit_collection.py"),
    target: "raw[6] = (raw[6] & 0x0F) | 0x40",
    mutated: "raw[6] = raw[6]",
    testFile: "tests/demo-kit-collection.test.ts"
  },
  {
    id: "M-K2.2",
    step: "Demo kit step 2 (kit-ids.json UUIDs follow the rule)",
    description:
      "Skip the UUID rule check and verify the problems test fails",
    filePath: resolve(ROOT, "demo-kit/kit_collection.py"),
    target: "if uuid != kit_uuid(seed):",
    mutated: "if False:",
    testFile: "tests/demo-kit-collection.test.ts"
  },
  {
    id: "M-K2.3",
    step: "Demo kit step 2 (Kit Beat writes monitoring_enabled)",
    description:
      "Write monitoring_enabled false and verify the beat and template tests fail",
    filePath: resolve(ROOT, "demo-kit/kit_collection.py"),
    target: "\"monitoring_enabled\": monitoring_type != 0}",
    mutated: "\"monitoring_enabled\": False}",
    testFile: "tests/demo-kit-collection.test.ts"
  },
  {
    id: "M-K2.4",
    step: "Demo kit step 2 (Playlister resume state is dropped)",
    description:
      "Keep the resume keys and verify the normalise tests fail",
    filePath: resolve(ROOT, "demo-kit/kit_collection.py"),
    target: "source.get(\"settings\", {}).pop(key, None)",
    mutated: "pass",
    testFile: "tests/demo-kit-collection.test.ts"
  },
  {
    id: "M-K2.5",
    step: "Demo kit step 2 (no round-trip path survives normalise)",
    description:
      "Accept the round-trip folder inside a string and verify the refusal test fails",
    filePath: resolve(ROOT, "demo-kit/kit_collection.py"),
    target: "if root_l in flat.lower():",
    mutated: "if False:",
    testFile: "tests/demo-kit-collection.test.ts"
  },
  {
    id: "M-K2.6",
    step: "Demo kit step 2 (the round-trip diff names changed values)",
    description:
      "Report no changed value and verify the diff tests fail",
    filePath: resolve(ROOT, "demo-kit/kit_collection.py"),
    target: "if not _same(d, s):",
    mutated: "if False:",
    testFile: "tests/demo-kit-collection.test.ts"
  },
  {
    id: "M-K2.7",
    step: "Demo kit step 2 (booleans are not numbers in the diff)",
    description:
      "Compare booleans by value and verify the boolean test fails",
    filePath: resolve(ROOT, "demo-kit/kit_collection.py"),
    target: "return a is b",
    mutated: "return a == b",
    testFile: "tests/demo-kit-collection.test.ts"
  },
  {
    id: "M-K2.8",
    step: "Demo kit step 2 (the template keeps the kit's source UUIDs)",
    description:
      "Skip the template UUID check and verify the UUID test fails",
    filePath: resolve(ROOT, "demo-kit/kit_collection.py"),
    target: "if saved.get(\"uuid\") != entry[\"uuid\"]:",
    mutated: "if False:",
    testFile: "tests/demo-kit-collection.test.ts"
  },
  {
    id: "M-K2.9",
    step: "Demo kit step 2 (the template has no absolute path)",
    description:
      "Skip the absolute-path check and verify the path tests fail",
    filePath: resolve(ROOT, "demo-kit/kit_collection.py"),
    target: "if ABSOLUTE.search(text) and not text.startswith((\"http://\", \"https://\")):",
    mutated: "if False:",
    testFile: "tests/demo-kit-collection.test.ts"
  },
  {
    id: "M-K2.10",
    step: "Demo kit step 2 (scene items point at their own source)",
    description:
      "Skip the item UUID check and verify the item test fails",
    filePath: resolve(ROOT, "demo-kit/kit_collection.py"),
    target: "if item.get(\"source_uuid\") != by_name.get(item.get(\"name\"), {}).get(\"uuid\"):",
    mutated: "if False:",
    testFile: "tests/demo-kit-collection.test.ts"
  },
  {
    id: "M-K2.11",
    step: "Demo kit step 2 (the 50 % copy has one row)",
    description:
      "Give Kit Clips 50% all three rows and verify the Playlister and template tests fail",
    filePath: resolve(ROOT, "demo-kit/kit_collection.py"),
    target: "\"Kit Clips 50%\": {\"playlist\": _playlist(\"hurdles\"),",
    mutated: "\"Kit Clips 50%\": {\"playlist\": _playlist(\"hurdles\", \"sprint\", \"train\"),",
    testFile: "tests/demo-kit-collection.test.ts"
  },
  {
    id: "M-K2.12",
    step: "Demo kit step 2 (the template is written as UTF-8 text)",
    description:
      "Escape non-ASCII and verify the dump and committed-template tests fail",
    filePath: resolve(ROOT, "demo-kit/kit_collection.py"),
    target: "json.dumps(data, indent=4, ensure_ascii=False)",
    mutated: "json.dumps(data, indent=4, ensure_ascii=True)",
    testFile: "tests/demo-kit-collection.test.ts"
  },
  {
    id: "M-K2.13",
    step: "Demo kit step 2 (the OBS lock is created exclusively)",
    description:
      "Open the lock without O_EXCL and verify the existing-lock test fails",
    filePath: resolve(ROOT, "demo-kit/kit_obs.py"),
    target: "os.O_CREAT | os.O_EXCL | os.O_WRONLY",
    mutated: "os.O_CREAT | os.O_WRONLY",
    testFile: "tests/demo-kit-collection.test.ts"
  },
  {
    id: "M-K2.14",
    step: "Demo kit step 2 (tasklist is checked before the lock)",
    description:
      "Skip the obs64 check before the lock and verify the running-OBS test fails",
    filePath: resolve(ROOT, "demo-kit/kit_obs.py"),
    target: "    if pids():\n        raise LockBusy(\"an obs64 is running\")",
    mutated: "    if False:\n        raise LockBusy(\"an obs64 is running\")",
    testFile: "tests/demo-kit-collection.test.ts"
  },
  {
    id: "M-K2.15",
    step: "Demo kit step 2 (only our own lock is deleted)",
    description:
      "Delete a lock that holds another token and verify the other-lock test fails",
    filePath: resolve(ROOT, "demo-kit/kit_obs.py"),
    target: "if lock.read_text(encoding=\"utf-8\").strip() != token:",
    mutated: "if False:",
    testFile: "tests/demo-kit-collection.test.ts"
  },
  {
    id: "M-K2.16",
    step: "Demo kit step 2 (a copied OBS tree must match its source)",
    description:
      "Skip the hash comparison and verify the differing-copy test fails",
    filePath: resolve(ROOT, "demo-kit/kit_obs.py"),
    target: "if want != got:",
    mutated: "if False:",
    testFile: "tests/demo-kit-collection.test.ts"
  },
  {
    id: "M-K2.17",
    step: "Demo kit step 2 (config OBS rewrote is kept)",
    description:
      "Always rewrite config and verify the second-run test fails",
    filePath: resolve(ROOT, "demo-kit/kit_obs.py"),
    target: "if not path.exists():\n        path.parent.mkdir(parents=True, exist_ok=True)",
    mutated: "if True:\n        path.parent.mkdir(parents=True, exist_ok=True)",
    testFile: "tests/demo-kit-collection.test.ts"
  },
  {
    id: "M-K2.18",
    step: "Demo kit step 2 (an earlier scene file is kept aside, never replaced)",
    description:
      "Always use the first run number and verify the keep-aside test fails",
    filePath: resolve(ROOT, "demo-kit/kit_obs.py"),
    target: "while path.with_name(f\"{path.name}.run{n}\").exists():",
    mutated: "while False:",
    testFile: "tests/demo-kit-collection.test.ts"
  },
  {
    id: "M-K2.19",
    step: "Demo kit step 2 (the template proves both plugins loaded)",
    description:
      "Skip the plugin-written keys check and verify the plugin test fails",
    filePath: resolve(ROOT, "demo-kit/kit_collection.py"),
    target: "            if lacking:\n",
    mutated: "            if False:\n",
    testFile: "tests/demo-kit-collection.test.ts"
  },
  {
    id: "M-K2.20",
    step: "Demo kit step 2 (every kit-ids.json filter has its settings)",
    description:
      "Skip the FILTERS coverage check and verify the coverage test fails",
    filePath: resolve(ROOT, "demo-kit/kit_collection.py"),
    target: "if seed not in FILTERS:",
    mutated: "if False:",
    testFile: "tests/demo-kit-collection.test.ts"
  },
  {
    id: "M-K2.21",
    step: "Demo kit step 2 (every scene item has its layout)",
    description:
      "Skip the LAYOUT coverage check and verify the coverage test fails",
    filePath: resolve(ROOT, "demo-kit/kit_collection.py"),
    target: "if item[\"source\"] not in layout:",
    mutated: "if False:",
    testFile: "tests/demo-kit-collection.test.ts"
  },
  {
    id: "M-K2.22",
    step: "Demo kit step 2 (a file: URL is an absolute path)",
    description:
      "Drop the file: alternative and verify the file-URL test fails",
    filePath: resolve(ROOT, "demo-kit/kit_collection.py"),
    target: "|(?i:file:/)\")",
    mutated: "\")",
    testFile: "tests/demo-kit-collection.test.ts"
  },
  {
    id: "M-K2.23",
    step: "Demo kit step 2 (the OBS log must show both plugins loaded)",
    description:
      "Skip the loaded-line check and verify the missing-plugin log test fails",
    filePath: resolve(ROOT, "demo-kit/kit_obs.py"),
    target: "if not any(f\"[{name}{LOADED_LINE}\" in line for line in lines)]",
    mutated: "if False]",
    testFile: "tests/demo-kit-collection.test.ts"
  },
  {
    id: "M-K2.24",
    step: "Demo kit step 2 (the lock is released when OBS fails)",
    description:
      "Never release the lock in the round-trip and verify the release test fails",
    filePath: resolve(ROOT, "demo-kit/kit_obs.py"),
    target: "\"released\": release_lock(lock, token)",
    mutated: "\"released\": False",
    testFile: "tests/demo-kit-collection.test.ts"
  },
  {
    id: "M-K2.25",
    step: "Demo kit step 2 (an OBS that ignores WM_CLOSE is killed and logged)",
    description:
      "Skip the taskkill and verify the no-exit test fails",
    filePath: resolve(ROOT, "demo-kit/kit_obs.py"),
    target: "subprocess.run([\"taskkill\", \"/PID\", str(proc.pid), \"/T\", \"/F\"], capture_output=True)",
    mutated: "pass",
    testFile: "tests/demo-kit-collection.test.ts"
  },
  {
    id: "M-K2.26",
    step: "Demo kit step 2 (placed media must match the media manifest)",
    description:
      "Skip the manifest sha1 check and verify the manifest test fails",
    filePath: resolve(ROOT, "demo-kit/kit_obs.py"),
    target: "if hashlib.sha1(source.read_bytes()).hexdigest() != entry[\"sha1\"]:",
    mutated: "if False:",
    testFile: "tests/demo-kit-collection.test.ts"
  },
  {
    id: "M-K2.27",
    step: "Demo kit step 2 (a differing placed file is never overwritten)",
    description:
      "Overwrite a differing target and verify the differing-target test fails",
    filePath: resolve(ROOT, "demo-kit/kit_obs.py"),
    target: "if not target.exists():\n            shutil.copy2(source, target)\n        elif sha256_of(target) != sha256_of(source):",
    mutated: "if True:\n            shutil.copy2(source, target)\n        elif False:",
    testFile: "tests/demo-kit-collection.test.ts"
  },
  {
    id: "M-K3.1",
    step: "Demo kit step 3 (CREDITS.md must give each clip's source page)",
    description:
      "Drop the page from the CREDITS.md check and verify the missing-page test fails",
    filePath: resolve(ROOT, "demo-kit/kit_docs.py"),
    target: "\"licence\": f\"Licence: {s['license']}, {s['license_url']}\", \"page\": s[\"page\"],",
    mutated: "\"licence\": f\"Licence: {s['license']}, {s['license_url']}\",",
    testFile: "tests/demo-kit-docs.test.ts"
  },
  {
    id: "M-K3.2",
    step: "Demo kit step 3 (a credit counts only in its own clip's section)",
    description:
      "Search the whole file instead of the clip's section and verify the other-section test fails",
    filePath: resolve(ROOT, "demo-kit/kit_docs.py"),
    target: "    return text[start:] if end < 0 else text[start:end]",
    mutated: "    return text",
    testFile: "tests/demo-kit-docs.test.ts"
  },
  {
    id: "M-K3.3",
    step: "Demo kit step 3 (every shipped clip is credited on screen)",
    description:
      "Make the on-screen check pass every line and verify the on-screen tests fail",
    filePath: resolve(ROOT, "demo-kit/kit_docs.py"),
    target: "        if entry not in line:",
    mutated: "        if False:",
    testFile: "tests/demo-kit-docs.test.ts"
  },
  {
    id: "M-K3.4",
    step: "Demo kit step 3 (the setup card runs nothing)",
    description:
      "Let <script> through the card check and verify the loads-or-runs test fails",
    filePath: resolve(ROOT, "demo-kit/kit_docs.py"),
    target: "r\"<script|<link",
    mutated: "r\"<link",
    testFile: "tests/demo-kit-docs.test.ts"
  },
  {
    id: "M-K3.5",
    step: "Demo kit step 3 (the do-not-rename names are in the box itself)",
    description:
      "Look for the names anywhere in the README and verify the box test fails",
    filePath: resolve(ROOT, "demo-kit/kit_docs.py"),
    target: "        if f\"`{name}`\" not in box:",
    mutated: "        if f\"`{name}`\" not in readme:",
    testFile: "tests/demo-kit-docs.test.ts"
  },
  {
    id: "M-K3.6",
    step: "Demo kit step 3 (Playlister speed is said to restart the clip)",
    description:
      "Drop 'restarts the clip' from the speed-text check and verify the speed-text test fails",
    filePath: resolve(ROOT, "demo-kit/kit_docs.py"),
    target: "\"Playlister speed is a setting: changing it restarts the clip\"]",
    mutated: "\"Playlister speed is a setting\"]",
    testFile: "tests/demo-kit-docs.test.ts"
  },
  {
    id: "M-K3.7",
    step: "Demo kit step 3 (no text promises more than 2x)",
    description:
      "Drop the past-2x check and verify the no-live-factor test fails",
    filePath: resolve(ROOT, "demo-kit/kit_docs.py"),
    target: "        if re.search(r\"\\b(4x|3x)\\b\", text):",
    mutated: "        if False:",
    testFile: "tests/demo-kit-docs.test.ts"
  },
  {
    id: "M-K3.8",
    step: "Demo kit step 3 (CREDITS.md states the changes made)",
    description:
      "Leave the Changes line out of CREDITS.md and verify the credit-field test fails",
    filePath: resolve(ROOT, "demo-kit/kit_docs.py"),
    target: "            f\"- Changes: {clip['changes']}\",\n",
    mutated: "",
    testFile: "tests/demo-kit-docs.test.ts"
  },
  {
    id: "M-K3.9",
    step: "Demo kit step 3 (the credits step refuses a clip missing on screen)",
    description:
      "Skip the on-screen check in write_credits and verify the credits-step test fails",
    filePath: resolve(ROOT, "demo-kit/build-kit.py"),
    target: "    problems += kd.on_screen_problems(kc.TEXTS[\"Kit Credits\"], clips)\n",
    mutated: "",
    testFile: "tests/demo-kit-media.test.ts"
  },
  {
    id: "M-K3.10",
    step: "Demo kit step 3 (the committed CREDITS.md follows the stock list)",
    description:
      "Credit every excerpt from second 0 and verify the committed-credits test fails",
    filePath: resolve(ROOT, "demo-kit/build-kit.py"),
    target: "\"sha1\": row[\"sha1\"], \"bytes\": row[\"bytes\"], \"start\": clip[\"start\"],",
    mutated: "\"sha1\": row[\"sha1\"], \"bytes\": row[\"bytes\"], \"start\": 0,",
    testFile: "tests/demo-kit-media.test.ts"
  },
  {
    id: "M-K3.11",
    step: "Demo kit step 3 (the on-screen credits name every shipped clip)",
    description:
      "Drop the train clip from the Kit Credits text and verify the on-screen test fails",
    filePath: resolve(ROOT, "demo-kit/kit_collection.py"),
    target: "\\u201cT3 Train Crossing \"\n                    \"Cooks River\\u201d by Unyxium, CC BY 4.0 \\u00b7 ",
    mutated: "",
    testFile: "tests/demo-kit-media.test.ts"
  },
  {
    id: "M-K3.12",
    step: "Demo kit step 3 (the round-trip loads the real setup card)",
    description:
      "Keep a differing earlier card and verify the real-card test fails",
    filePath: resolve(ROOT, "demo-kit/kit_obs.py"),
    target: "        if card.exists() and card.read_bytes() != setup_card.read_bytes():\n            keep_aside(card)\n",
    mutated: "",
    testFile: "tests/demo-kit-collection.test.ts"
  },
  {
    id: "M-K3.13",
    step: "Demo kit step 3 (the README says each of its required phrases)",
    description:
      "Check no required README phrase and verify the 260-characters test fails",
    filePath: resolve(ROOT, "demo-kit/kit_docs.py"),
    target: "for words in README_MUSTS if words not in readme]",
    mutated: "for words in [] if words not in readme]",
    testFile: "tests/demo-kit-docs.test.ts"
  },
  {
    id: "M-K3.14",
    step: "Demo kit step 3 (the README names every scene)",
    description:
      "Drop the scene check from the README check and verify the every-scene test fails",
    filePath: resolve(ROOT, "demo-kit/kit_docs.py"),
    target: "        if scene[\"name\"] not in readme:",
    mutated: "        if False:",
    testFile: "tests/demo-kit-docs.test.ts"
  },
  {
    id: "M-K3.15",
    step: "Demo kit step 3 (the setup card gives every step)",
    description:
      "Drop the step-phrase check from the card check and verify the missing-step test fails",
    filePath: resolve(ROOT, "demo-kit/kit_docs.py"),
    target: "        if words not in html:",
    mutated: "        if False:",
    testFile: "tests/demo-kit-docs.test.ts"
  },
  {
    id: "M-K3.16",
    step: "Demo kit step 3 (the setup card is laid out at 1280x720)",
    description:
      "Drop the canvas check from the card check and verify the canvas test fails",
    filePath: resolve(ROOT, "demo-kit/kit_docs.py"),
    target: "    if \"width: 1280px; height: 720px\" not in html:",
    mutated: "    if False:",
    testFile: "tests/demo-kit-docs.test.ts"
  },
  {
    id: "M-K3.17",
    step: "Demo kit step 3 (the setup card declares UTF-8)",
    description:
      "Drop the charset check from the card check and verify the charset test fails",
    filePath: resolve(ROOT, "demo-kit/kit_docs.py"),
    target: "    if '<meta charset=\"utf-8\">' not in html:",
    mutated: "    if False:",
    testFile: "tests/demo-kit-docs.test.ts"
  },
  {
    id: "M-K3.18",
    step: "Demo kit step 3 (the 100 % note says the transport keys drive it)",
    description:
      "Accept a bare '100 %' note and verify the transport-keys test fails",
    filePath: resolve(ROOT, "demo-kit/kit_docs.py"),
    target: "\"Speed Note 100\": [\"100 %\", \"Previous, Play / pause and Next\"],",
    mutated: "\"Speed Note 100\": [\"100 %\"],",
    testFile: "tests/demo-kit-docs.test.ts"
  },
  {
    id: "M-K4.1",
    step: "Demo kit step 4 (a Playlister key binds only a kit Playlister)",
    description:
      "Accept any kit source as a Playlister and verify the not-a-Playlister test fails",
    filePath: resolve(ROOT, "scripts/build-kit-profiles.ts"),
    target: "if (!source || source.id !== \"obs_playlister_source\") {",
    mutated: "if (!source) {",
    testFile: "tests/demo-kit-profiles.test.ts"
  },
  {
    id: "M-K4.2",
    step: "Demo kit step 4 (a Playlister key's inspector name matches its uuid)",
    description:
      "Drop the inputName check and verify the name test fails",
    filePath: resolve(ROOT, "scripts/build-kit-profiles.ts"),
    target: "} else if (s.inputName !== source.name) {",
    mutated: "} else if (false) {",
    testFile: "tests/demo-kit-profiles.test.ts"
  },
  {
    id: "M-K4.3",
    step: "Demo kit step 4 (a filter control's kind matches the kit filter)",
    description:
      "Drop the filterKind check and verify the kind test fails",
    filePath: resolve(ROOT, "scripts/build-kit-profiles.ts"),
    target: "} else if (s.filterKind !== filter.versioned_id) {",
    mutated: "} else if (false) {",
    testFile: "tests/demo-kit-profiles.test.ts"
  },
  {
    id: "M-K4.4",
    step: "Demo kit step 4 (a filter control rides a table setting)",
    description:
      "Drop the setting check and verify the setting test fails",
    filePath: resolve(ROOT, "scripts/build-kit-profiles.ts"),
    target: "if (!toggle && !isTableSetting(text(s.filterKind), text(s.setting))) {",
    mutated: "if (false) {",
    testFile: "tests/demo-kit-profiles.test.ts"
  },
  {
    id: "M-K4.5",
    step: "Demo kit step 4 (a layer key's item is the source it names)",
    description:
      "Drop the item-to-source check and verify the layer test fails",
    filePath: resolve(ROOT, "scripts/build-kit-profiles.ts"),
    target: "} else if (s.sourceUuid !== source.uuid || s.sourceName !== source.name) {",
    mutated: "} else if (false) {",
    testFile: "tests/demo-kit-profiles.test.ts"
  },
  {
    id: "M-K4.6",
    step: "Demo kit step 4 (a scene key stays within the kit's scenes)",
    description:
      "Drop the scene-count bound and verify the scene test fails",
    filePath: resolve(ROOT, "scripts/build-kit-profiles.ts"),
    target: "if (!index || Number(index[1]) >= ids.scenes.length) {",
    mutated: "if (!index) {",
    testFile: "tests/demo-kit-profiles.test.ts"
  },
  {
    id: "M-K4.7",
    step: "Demo kit step 4 (captions are shipped or the control's own name)",
    description:
      "Accept every caption and verify the caption test fails",
    filePath: resolve(ROOT, "scripts/build-kit-profiles.ts"),
    target: "if (!isGeneratedCaption(action, context, entry.label) && !own.filter(Boolean).includes(entry.label)) {",
    mutated: "if (false) {",
    testFile: "tests/demo-kit-profiles.test.ts"
  },
  {
    id: "M-K4.8",
    step: "Demo kit step 4 (a caption may only name the control's own target)",
    description:
      "Accept any kit name as a caption and verify the other-target test fails",
    filePath: resolve(ROOT, "scripts/build-kit-profiles.ts"),
    target: "!own.filter(Boolean).includes(entry.label)",
    mutated: "![...byName.keys(), ...ids.sources.flatMap((x) => (x.filters ?? []).map((f) => f.name))].includes(entry.label)",
    testFile: "tests/demo-kit-profiles.test.ts"
  },
  {
    id: "M-K4.9",
    step: "Demo kit step 4 (the VJster page drives the OBS page)",
    description:
      "Drop the target check and verify the VJster target test fails",
    filePath: resolve(ROOT, "scripts/build-kit-profiles.ts"),
    target: "if (slot.settings?.target !== \"obs\") problems.push",
    mutated: "if (false) problems.push",
    testFile: "tests/demo-kit-profiles.test.ts"
  },
  {
    id: "M-K4.10",
    step: "Demo kit step 4 (the build runs validatePreset)",
    description:
      "Skip validatePreset in the kit build and verify the refusal test fails",
    filePath: resolve(ROOT, "scripts/build-kit-profiles.ts"),
    target: "  validatePreset(layouts.fadester, manifest);\n",
    mutated: "",
    testFile: "tests/demo-kit-profiles.test.ts"
  },
  {
    id: "M-K4.11",
    step: "Demo kit step 4 (the kit is Studio Mode (K.6))",
    description:
      "Drop the Studio Mode check and verify the regular-mode test fails",
    filePath: resolve(ROOT, "scripts/build-kit-profiles.ts"),
    target: "if (preset.obsMode !== \"studio\") problems.push",
    mutated: "if (false) problems.push",
    testFile: "tests/demo-kit-profiles.test.ts"
  },
  {
    id: "M-K4.12",
    step: "Demo kit step 4 (the files are named as the README promises)",
    description:
      "Name the Fadester file by its slug and verify the file-name test fails",
    filePath: resolve(ROOT, "scripts/build-kit-profiles.ts"),
    target: "{ file: names[0]!, bytes: zip(fadester.files) }",
    mutated: "{ file: \"suite-demo-kit-plus.streamDeckProfile\", bytes: zip(fadester.files) }",
    testFile: "tests/demo-kit-profiles.test.ts"
  },
  {
    id: "M-K4.13",
    step: "Demo kit step 4 (Restart acts on the 50 % copy)",
    description:
      "Bind Restart to Kit Clips and verify the binding test fails",
    filePath: resolve(ROOT, "demo-kit/kit-layouts.json"),
    target: "\"inputUuid\": \"ad976ab1-d3e3-4df7-a389-c99a8a428110\", \"inputName\": \"Kit Clips 50%\", \"operation\": \"restart\"",
    mutated: "\"inputUuid\": \"7e4a69df-9d56-4d73-9dea-9673994305d0\", \"inputName\": \"Kit Clips\", \"operation\": \"restart\"",
    testFile: "tests/demo-kit-profiles.test.ts"
  },
  {
    id: "M-K4.14",
    step: "Demo kit step 4 (Visuals' scene key cues the Visuals scene in Preview)",
    description:
      "Point the Visuals page's scene key at scene index 2 and verify the scene test fails",
    filePath: resolve(ROOT, "demo-kit/kit-layouts.json"),
    target: "\"label\": \"Scene 2\", \"settings\": { \"sceneTarget\": \"__scene_index_1__\", \"operation\": \"preview\" }",
    mutated: "\"label\": \"Scene 3\", \"settings\": { \"sceneTarget\": \"__scene_index_2__\", \"operation\": \"preview\" }",
    testFile: "tests/demo-kit-profiles.test.ts"
  },
  {
    id: "M-K4.15",
    step: "Demo kit step 4 (the VJster page's transport drives the OBS page)",
    description:
      "Set Play / pause to the browser and verify the VJster test fails",
    filePath: resolve(ROOT, "demo-kit/kit-layouts.json"),
    // kit-layouts.json is pretty-printed since K.6.
    target: "\"kind\": \"transport\",\n        \"at\": [\n          3,\n          0\n        ],\n        \"settings\": {\n          \"target\": \"obs\"",
    mutated: "\"kind\": \"transport\",\n        \"at\": [\n          3,\n          0\n        ],\n        \"settings\": {\n          \"target\": \"browser\"",
    testFile: "tests/demo-kit-profiles.test.ts"
  },
  {
    id: "M-K4.16",
    step: "Demo kit step 4 (a scene key is captioned for its own scene)",
    description:
      "Drop the scene-caption check and verify the caption test fails",
    filePath: resolve(ROOT, "scripts/build-kit-profiles.ts"),
    target: "} else if (entry.label !== `Scene ${Number(index[1]) + 1}`) {",
    mutated: "} else if (false) {",
    testFile: "tests/demo-kit-profiles.test.ts"
  },
  {
    id: "M-K4.17",
    step: "Demo kit step 4 (a filter control's inspector name matches its uuid)",
    description:
      "Drop the filter sourceName check and verify the name test fails",
    filePath: resolve(ROOT, "scripts/build-kit-profiles.ts"),
    target: "} else if (s.sourceName !== source.name) {",
    mutated: "} else if (false) {",
    testFile: "tests/demo-kit-profiles.test.ts"
  },
  {
    id: "M-K4.18",
    step: "Demo kit step 4 (a fader rides only kit media)",
    description:
      "Accept any kit source as a fader target and verify the not-media test fails",
    filePath: resolve(ROOT, "scripts/build-kit-profiles.ts"),
    target: "if (!source || source.id !== \"ffmpeg_source\") {",
    mutated: "if (!source) {",
    testFile: "tests/demo-kit-profiles.test.ts"
  },
  {
    id: "M-K4.19",
    step: "Demo kit step 4 (a layer key has a fixed scene)",
    description:
      "Drop the scope half of the fixed check and verify the scope test fails",
    filePath: resolve(ROOT, "scripts/build-kit-profiles.ts"),
    target: "if (s.scope !== \"fixed\" || s.target !== \"fixed\") {",
    mutated: "if (s.target !== \"fixed\") {",
    testFile: "tests/demo-kit-profiles.test.ts"
  },
  {
    id: "M-K4.20",
    step: "Demo kit step 4 (a layer key has a fixed source)",
    description:
      "Drop the target half of the fixed check and verify the target test fails",
    filePath: resolve(ROOT, "scripts/build-kit-profiles.ts"),
    target: "if (s.scope !== \"fixed\" || s.target !== \"fixed\") {",
    mutated: "if (s.scope !== \"fixed\") {",
    testFile: "tests/demo-kit-profiles.test.ts"
  },
  {
    id: "M-K4.21",
    step: "Demo kit step 4 (the build names exactly two profiles)",
    description:
      "Drop the two-names check and verify the one-name test fails",
    filePath: resolve(ROOT, "scripts/build-kit-profiles.ts"),
    target: "if (names.length !== 2) throw",
    mutated: "if (false) throw",
    testFile: "tests/demo-kit-profiles.test.ts"
  },
  {
    id: "M-K4.22",
    step: "Demo kit step 4 (a kit_docs.py without PROFILE_FILES is refused by name)",
    description:
      "Drop the missing-line check and verify the PROFILE_FILES test fails",
    filePath: resolve(ROOT, "scripts/build-kit-profiles.ts"),
    target: "if (!line) throw new Error(\"kit_docs.py has no PROFILE_FILES line\");",
    mutated: "if (false) throw new Error(\"kit_docs.py has no PROFILE_FILES line\");",
    testFile: "tests/demo-kit-profiles.test.ts"
  },
  {
    id: "M-K4.23",
    step: "Demo kit step 4 (the VJster profile name has no OBS or YouTube)",
    description:
      "Drop the name check and verify the VJster name test fails",
    filePath: resolve(ROOT, "scripts/build-kit-profiles.ts"),
    target: "if (/\\b(OBS|YouTube)\\b/i.test(layout.name)) problems.push",
    mutated: "if (false) problems.push",
    testFile: "tests/demo-kit-profiles.test.ts"
  },
  {
    id: "M-K5.1",
    step: "Demo kit step 5 (the import keeps a path that leaves the folder)",
    description:
      "Drop the prefix check and verify the leaving-path test fails",
    filePath: resolve(ROOT, "demo-kit/kit_check.py"),
    target: "    if not absolute.startswith(root):\n        return path",
    mutated: "    if False:\n        return path",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.2",
    step: "Demo kit step 5 (the import needs a separator after the folder)",
    description:
      "Drop the separator check and verify the drive-root and sibling tests fail",
    filePath: resolve(ROOT, "demo-kit/kit_check.py"),
    target: "if absolute[len(root):len(root) + 1] != \"\\\\\":",
    mutated: "if False:",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.3",
    step: "Demo kit step 5 (the import keeps a path past MAX_PATH)",
    description:
      "Lift the MAX_PATH limit on the input and verify the long-path test fails",
    filePath: resolve(ROOT, "demo-kit/kit_check.py"),
    target: "    if len(path.encode(\"utf-16-le\")) // 2 >= MAX_PATH:\n        return None",
    mutated: "    if False:\n        return None",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.4",
    step: "Demo kit step 5 (the import translates arrays too)",
    description:
      "Skip arrays and verify the playlist-row tests fail",
    filePath: resolve(ROOT, "demo-kit/kit_check.py"),
    target: "        return [translate_paths(v, root_dir) for v in value]",
    mutated: "        return value",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.5",
    step: "Demo kit step 5 (the import keeps the dialog's name)",
    description:
      "Always name the collection OBS Studio Import and verify the name test fails",
    filePath: resolve(ROOT, "demo-kit/kit_check.py"),
    target: "out[\"name\"] = name or data[\"name\"] or \"OBS Studio Import\"",
    mutated: "out[\"name\"] = \"OBS Studio Import\"",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.6",
    step: "Demo kit step 5 (a live path must be inside the unzip folder)",
    description:
      "Drop the inside check and verify the wrong-path test fails",
    filePath: resolve(ROOT, "demo-kit/kit_check.py"),
    target: "        elif not inside(path, kit_dir):",
    mutated: "        elif False:",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.7",
    step: "Demo kit step 5 (a live path must exist)",
    description:
      "Drop the exists check and verify the wrong-path test fails",
    filePath: resolve(ROOT, "demo-kit/kit_check.py"),
    target: "        elif not os.path.isfile(path):",
    mutated: "        elif False:",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.8",
    step: "Demo kit step 5 (Playlister rows are live paths)",
    description:
      "Skip playlist rows and verify the path tests fail",
    filePath: resolve(ROOT, "demo-kit/kit_check.py"),
    target: "for row in settings.get(\"playlist\") or []:",
    mutated: "for row in []:",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.9",
    step: "Demo kit step 5 (a filter key needs its kind)",
    description:
      "Drop the filter kind check and verify the filter-key test fails",
    filePath: resolve(ROOT, "demo-kit/kit_check.py"),
    target: "if response.get(\"filterKind\") != s.get(\"filterKind\"):",
    mutated: "if False:",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.10",
    step: "Demo kit step 5 (a scene key needs its position's scene)",
    description:
      "Take the kit's scene as the live one and verify the scene-position test fails",
    filePath: resolve(ROOT, "demo-kit/kit_check.py"),
    target: "got = order[index][\"sceneName\"] if index < len(order) else None",
    mutated: "got = want",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.11",
    step: "Demo kit step 5 (scene positions follow the Scenes dock)",
    description:
      "Sort scenes bottom first and verify the scene-order test fails",
    filePath: resolve(ROOT, "demo-kit/kit_check.py"),
    target: "key=lambda s: -s[\"sceneIndex\"]",
    mutated: "key=lambda s: s[\"sceneIndex\"]",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.12",
    step: "Demo kit step 5 (a layer key needs its item to be its source)",
    description:
      "Drop the item source check and verify the layer-key test fails",
    filePath: resolve(ROOT, "demo-kit/kit_check.py"),
    target: "if response is not None and response.get(\"sourceUuid\") != s.get(\"sourceUuid\"):",
    mutated: "if False:",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.13",
    step: "Demo kit step 5 (a Playlister key needs a Playlister)",
    description:
      "Drop the Playlister kind check and verify the Playlister-key test fails",
    filePath: resolve(ROOT, "demo-kit/kit_check.py"),
    target: "if response is not None and response.get(\"inputKind\") != PLAYLISTER_KIND:",
    mutated: "if False:",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.14",
    step: "Demo kit step 5 (a Panic key needs both hotkeys)",
    description:
      "Drop the hotkey check and verify the Panic-key test fails",
    filePath: resolve(ROOT, "demo-kit/kit_check.py"),
    target: "            if missing:",
    mutated: "            if False:",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.15",
    step: "Demo kit step 5 (an unknown action fails)",
    description:
      "Accept unknown actions and verify the unknown-action test fails",
    filePath: resolve(ROOT, "demo-kit/kit_check.py"),
    target: "return [f\"{where}: an action this check does not know\"]",
    mutated: "return []",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.16",
    step: "Demo kit step 5 (VJster keys target the Speed Page)",
    description:
      "Drop the VJster target check and verify its test fails",
    filePath: resolve(ROOT, "demo-kit/kit_check.py"),
    target: "if s.get(\"target\") != \"obs\":",
    mutated: "if False:",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.17",
    step: "Demo kit step 5 (an older plugin fails)",
    description:
      "Drop the minimum version check and verify the version test fails",
    filePath: resolve(ROOT, "demo-kit/kit_check.py"),
    target: "elif version_tuple(got) < version_tuple(want[\"min_version\"]):",
    mutated: "elif False:",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.18",
    step: "Demo kit step 5 (versions compare as numbers)",
    description:
      "Compare versions as text and verify the 0.10.0 test fails",
    filePath: resolve(ROOT, "demo-kit/kit_check.py"),
    target: "return tuple(int(p) for p in version.split(\".\") if p.isdigit())",
    mutated: "return tuple(version.split(\".\"))",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.19",
    step: "Demo kit step 5 (a key absent before Panic is at its default after Restore)",
    description:
      "Ignore defaults and verify the Restore test fails",
    filePath: resolve(ROOT, "demo-kit/kit_check.py"),
    target: "was = before.get(key, defaults.get(key))",
    mutated: "was = before.get(key)",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.20",
    step: "Demo kit step 5 (shader uniform defaults are numbers)",
    description:
      "Keep the uniform defaults as text and verify the shader test fails",
    filePath: resolve(ROOT, "demo-kit/kit_check.py"),
    target: "out[name] = value == \"true\" if value in (\"true\", \"false\") else float(value)",
    mutated: "out[name] = value",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.21",
    step: "Demo kit step 5 (the zip's media must be the manifest's)",
    description:
      "Drop the manifest SHA-1 check and verify the refusal test fails",
    filePath: resolve(ROOT, "demo-kit/kit_package.py"),
    target: "elif hashlib.sha1(source.read_bytes()).hexdigest() != entry[\"sha1\"]:",
    mutated: "elif False:",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.22",
    step: "Demo kit step 5 (the zip's text files have LF line ends)",
    description:
      "Pack text files as they are and verify the LF test fails",
    filePath: resolve(ROOT, "demo-kit/kit_package.py"),
    target: "return data.replace(b\"\\r\\n\", b\"\\n\") if name.endswith(TEXT_SUFFIXES) else data",
    mutated: "return data",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.23",
    step: "Demo kit step 5 (the zip's entries are sorted)",
    description:
      "Leave the entries unsorted and verify the zip test fails",
    filePath: resolve(ROOT, "demo-kit/kit_package.py"),
    target: "    return sorted(entries)",
    mutated: "    return entries",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.24",
    step: "Demo kit step 5 (an earlier zip that differs is kept)",
    description:
      "Overwrite nothing and verify the changed-zip test fails",
    filePath: resolve(ROOT, "demo-kit/kit_package.py"),
    target: "    if target.exists() and target.read_bytes() != data:\n        keep_aside(target)\n",
    mutated: "",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.25",
    step: "Demo kit step 5 (the zip holds CREDITS.md)",
    description:
      "Leave CREDITS.md out and verify the README-table test fails",
    filePath: resolve(ROOT, "demo-kit/kit_package.py"),
    target: "DOCS = [\"README.md\", \"CREDITS.md\", kc.SETUP_CARD]",
    mutated: "DOCS = [\"README.md\", kc.SETUP_CARD]",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.26",
    step: "Demo kit step 5 (the check never overwrites an unzipped file)",
    description:
      "Drop the differing-file refusal and verify the unzip test fails",
    filePath: resolve(ROOT, "demo-kit/check-kit.py"),
    target: "                if target.read_bytes() != data:",
    mutated: "                if False:",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.27",
    step: "Demo kit step 5 (the check's websocket config is its own)",
    description:
      "Drop the port check and verify the config test fails",
    filePath: resolve(ROOT, "demo-kit/check-kit.py"),
    target: "if not config.get(\"server_enabled\") or config.get(\"server_port\") != port:",
    mutated: "if False:",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.28",
    step: "Demo kit step 5 (a failing row is recorded)",
    description:
      "Swallow a row's exception and verify the results test fails",
    filePath: resolve(ROOT, "demo-kit/check-kit.py"),
    target: "self.add(row, False, f\"{type(exc).__name__}: {exc}\")",
    mutated: "pass",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.29",
    step: "Demo kit step 5 (the page key never reaches the results)",
    description:
      "Keep the token and verify the redaction test fails",
    filePath: resolve(ROOT, "demo-kit/check-kit.py"),
    target: "re.sub(r\"#token=[0-9a-f]+\", \"#token=<not kept>\", line[\"address\"])",
    mutated: "line[\"address\"]",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.30",
    step: "Demo kit step 5 (the saved collection's name is not compared)",
    description:
      "Compare the GUI's name and verify the saved test fails",
    filePath: resolve(ROOT, "demo-kit/check-kit.py"),
    target: "    normalised[\"name\"] = ids[\"collection\"]",
    mutated: "    pass",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.31",
    step: "Demo kit step 5 (the speed run places each action's kind)",
    description:
      "Make every action a speed dial and verify the layout test fails",
    filePath: resolve(ROOT, "scripts/kit-speed-run.ts"),
    target: "    action: `${UUID}.${c.kind}`,",
    mutated: "    action: `${UUID}.speed`,",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.32",
    step: "Demo kit step 5 (a filter key's setting must exist)",
    description:
      "Drop the setting check and verify the filter-key test fails",
    filePath: resolve(ROOT, "demo-kit/kit_check.py"),
    target: "                if setting not in known:",
    mutated: "                if False:",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.33",
    step: "Demo kit step 5 (a plugin that did not load fails)",
    description:
      "Skip a plugin with no version line and verify the version test fails",
    filePath: resolve(ROOT, "demo-kit/kit_check.py"),
    target: "        if got is None:\n            problems.append(",
    mutated: "        if got is None:\n            continue\n            problems.append(",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.34",
    step: "Demo kit step 5 (obs-websocket's authentication string)",
    description:
      "Hash the challenge before the secret and verify the protocol example fails",
    filePath: resolve(ROOT, "demo-kit/kit_check.py"),
    target: "(secret + challenge)",
    mutated: "(challenge + secret)",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.35",
    step: "Demo kit step 5 (the zip's top level counts a folder once)",
    description:
      "List every entry as top level and verify the README-table test fails",
    filePath: resolve(ROOT, "demo-kit/kit_check.py"),
    target: "n.split(\"/\", 1)[0] + \"/\" if \"/\" in n else n for n in names",
    mutated: "n for n in names",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.36",
    step: "Demo kit step 5 (Restore allows a float rounding)",
    description:
      "Drop the 1e-6 tolerance and verify the Restore test fails",
    filePath: resolve(ROOT, "demo-kit/kit_check.py"),
    target: "and abs(was - now) < 1e-6",
    mutated: "and False",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.37",
    step: "Demo kit step 5 (int and bool uniforms have defaults too)",
    description:
      "Read float uniforms only and verify the shader test fails",
    filePath: resolve(ROOT, "demo-kit/kit_check.py"),
    target: "(?:float|int|bool)",
    mutated: "(?:float)",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.38",
    step: "Demo kit step 5 (a uniform's annotations span lines)",
    description:
      "Drop DOTALL and verify the shader test fails",
    filePath: resolve(ROOT, "demo-kit/kit_check.py"),
    target: "re.MULTILINE | re.DOTALL)",
    mutated: "re.MULTILINE)",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.39",
    step: "Demo kit step 5 (unzip keeps every file inside the kit folder)",
    description:
      "Drop the containment check and verify the leaving-name test fails",
    filePath: resolve(ROOT, "demo-kit/check-kit.py"),
    target: "            if not target.is_relative_to(root) or target == root:",
    mutated: "            if False:",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.40",
    step: "Demo kit step 5 (compare-import writes nothing into the unzip folder)",
    description:
      "Write the results into the unzip folder and verify the compare-import test fails",
    filePath: resolve(ROOT, "demo-kit/check-kit.py"),
    target: "out = Results(args.out.resolve() if args.out else None)",
    mutated: "out = Results(args.out.resolve() if args.out else args.kit_dir.resolve() / \"compare-import.jsonl\")",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.41",
    step: "Demo kit step 5 (a failed plugins row stops the later rows)",
    description:
      "Never block and verify the plugins-gate test fails",
    filePath: resolve(ROOT, "demo-kit/check-kit.py"),
    target: "                blocked = True",
    mutated: "                pass",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.42",
    step: "Demo kit step 5 (an input muted already stays muted)",
    description:
      "Mute and unmute whatever the input's state and verify the mute test fails",
    filePath: resolve(ROOT, "demo-kit/check-kit.py"),
    target: "        if self.obs.req(\"GetInputMute\", uuid)[\"inputMuted\"]:\n            return",
    mutated: "        if False:\n            return",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.43",
    step: "Demo kit step 5 (one failing undo does not skip the others)",
    description:
      "Stop at the first failing undo and verify the put-back test fails",
    filePath: resolve(ROOT, "demo-kit/check-kit.py"),
    target: "failed.append(f\"{step[0]} {step[1]}: {type(exc).__name__}: {exc}\")",
    mutated: "raise",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-K5.44",
    step: "Demo kit step 5 (a failure after Panic still sends Restore)",
    description:
      "Drop the Restore in the finally and verify the Panic test fails",
    filePath: resolve(ROOT, "demo-kit/check-kit.py"),
    target: "            if not restore_sent:",
    mutated: "            if False:",
    testFile: "tests/demo-kit-check.test.ts"
  },
  {
    id: "M-TB.1",
    step: "Scene mixer take on OBS 33.0.1 (the T-bar release cancels)",
    description:
      "Release the T-bar at the take (the kit 1.1 failure) instead of leaving Studio Mode and verify the take test fails",
    filePath: resolve(ROOT, "src/obs/direct-obs-client.ts"),
    target: 'await this.sendObsRequest("SetTBarPosition", { position: 1, release: false });\n      this.requireControlGeneration(generation);\n      left = true;',
    mutated: 'await this.sendObsRequest("SetTBarPosition", { position: 1, release: true });\n      this.requireControlGeneration(generation);\n      return 0;',
    testFile: "tests/scene-cycle.test.ts"
  },
  {
    id: "M-TB.2",
    step: "Scene mixer take (once OBS left Studio Mode it is always asked back)",
    description:
      "Skip the re-enable in the finally after a failed leave request and verify the timeout test fails",
    filePath: resolve(ROOT, "src/obs/direct-obs-client.ts"),
    target: "      if (left && !restoreTried) restored = await this.restoreStudioMode();",
    mutated: "      if (left && !restoreTried && !left) restored = await this.restoreStudioMode();",
    testFile: "tests/scene-cycle.test.ts"
  },
  {
    id: "M-TB.3",
    step: "Scene mixer take (a press in the settle window does not take again)",
    description:
      "Drop the settle guard on the press and verify the settle-window press test fails",
    filePath: resolve(ROOT, "src/obs/direct-obs-client.ts"),
    target: "      if (Date.now() < this.tbarSettleUntil) return Promise.resolve(this.catalog.tbarPosition);",
    mutated: "      if (Date.now() < 0) return Promise.resolve(this.catalog.tbarPosition);",
    testFile: "tests/scene-cycle.test.ts"
  }
];

function runVitest(testFile?: string): { status: number; output: string } {
  const vitestEntry = resolve(ROOT, "node_modules/vitest/vitest.mjs");
  const args = [vitestEntry, "run", "--reporter=basic"];
  if (testFile) {
    args.push(testFile);
  }
  const res = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8"
  });
  return {
    status: res.status ?? 1,
    output: `${res.stdout ?? ""}\n${res.stderr ?? ""}`
  };
}

function main(): void {
  console.log("=== Phase 1 Mutation Check Runner ===");
  for (const m of MUTATIONS) {
    const originalBytes = readFileSync(m.filePath);
    const originalText = originalBytes.toString("utf8");
    const normalizedOriginal = originalText.replace(/\r\n/g, "\n");
    const useCrLf = originalText.includes("\r\n");

    if (!normalizedOriginal.includes(m.target)) {
      throw new Error(
        `[${m.id}] Target string not found in ${m.filePath}:\n${m.target}`
      );
    }

    const mutatedNormalized = normalizedOriginal.replace(m.target, m.mutated);
    const mutatedText = useCrLf
      ? mutatedNormalized.replace(/\n/g, "\r\n")
      : mutatedNormalized;

    try {
      writeFileSync(m.filePath, Buffer.from(mutatedText, "utf8"));
      const result = runVitest(m.testFile);
      if (result.status === 0) {
        throw new Error(
          `[${m.id}] Mutation survived! Expected ${m.testFile} to fail, but it passed.`
        );
      }
      // A mutation must be killed by a failing assertion, not by a file that
      // no longer loads (a syntax or import error fails with no test failed).
      // eslint-disable-next-line no-control-regex
      const plainOutput = result.output.replace(/\x1b\[[0-9;]*m/g, "");
      if (!/Tests\s+\d+ failed/.test(plainOutput)) {
        throw new Error(
          `[${m.id}] ${m.testFile} failed without a failing test:\n${result.output}`
        );
      }
      console.log(
        `[KILLED] ${m.id} (${m.step}): ${m.description} -> ${m.testFile} exited with code ${result.status}`
      );
    } finally {
      writeFileSync(m.filePath, originalBytes);
    }
  }

  console.log("\nRe-running full test suite after restoring all files...");
  const finalRun = runVitest();
  if (finalRun.status !== 0) {
    console.error(finalRun.output);
    throw new Error("Post-mutation full test suite failed!");
  }
  console.log(`All ${MUTATIONS.length} mutations killed and full test suite restored green.`);
}

main();
