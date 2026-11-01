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
      "com.jbrick2070.fadester-for-obs.sdPlugin/manifest.json"
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
    filePath: resolve(ROOT, "com.jbrick2070.fadester-for-obs.sdPlugin/ui/i18n.js"),
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
    filePath: resolve(ROOT, "com.jbrick2070.fadester-for-obs.sdPlugin/ui/playlister-transport-key.html"),
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
    target: "    this.current = copyOf(settings);\n    // A whole settings object is known now: saves need not wait for the start-up read.\n    this.resolveReady();\n",
    mutated: "    this.current = copyOf(settings);\n",
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
    target: "if (!this.replaced && !this.written) this.current = copyOf(stored);",
    mutated: "if (!this.replaced) this.current = copyOf(stored);",
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
    id: "M-11.2a",
    step: "Step L.2 (the direct settings pages)",
    description: "Make the direct page ignore language.resolved (no refill), and verify direct-pi-language.test.ts fails",
    filePath: resolve(ROOT, "com.jbrick2070.fadester-for-obs.sdPlugin/ui/direct-pi.js"),
    target: "    if (!window.FadesterI18n.setResolved(language.resolved)) return;",
    mutated: "    return;",
    testFile: "tests/direct-pi-language.test.ts"
  },
  {
    id: "M-11.2b",
    step: "Step L.2 (the direct settings pages)",
    description: "Make the Language select send nothing on a change, and verify direct-pi-language.test.ts fails",
    filePath: resolve(ROOT, "com.jbrick2070.fadester-for-obs.sdPlugin/ui/direct-pi.js"),
    target: '      sendToPlugin({ event: "setLanguageChoice", choice: languagePicker.value });',
    mutated: "      void languagePicker;",
    testFile: "tests/direct-pi-language.test.ts"
  },
  {
    id: "M-11.2c",
    step: "Step L.2 (the direct settings pages)",
    description: "Set the Language select only when the resolved language changes, and verify direct-pi-language.test.ts fails",
    filePath: resolve(ROOT, "com.jbrick2070.fadester-for-obs.sdPlugin/ui/direct-pi.js"),
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
    filePath: resolve(ROOT, "com.jbrick2070.fadester-for-obs.sdPlugin/ui/direct-pi.js"),
    target: "      if (!window.FadesterI18n.setResolved(recalledLanguage())) {",
    mutated: "      if (!window.FadesterI18n.setResolved(null)) {",
    testFile: "tests/direct-pi-language.test.ts"
  },
  {
    id: "M-11.2e",
    step: "Step L.2 (the direct settings pages)",
    description:
      "Let the pages' setResolved (generated ui/i18n.js) take any code through the Automatic mapping, so a stale remembered value is used, and verify direct-pi-language.test.ts fails",
    filePath: resolve(ROOT, "com.jbrick2070.fadester-for-obs.sdPlugin/ui/i18n.js"),
    target: '    return typeof code === "string" && PLUGIN_LANGUAGES.indexOf(code) !== -1 ? use(code) : null;',
    mutated: "    return use(normalize(code));",
    testFile: "tests/direct-pi-language.test.ts"
  },
  {
    id: "M-11.2f",
    step: "Step L.2 (the direct settings pages)",
    description: "Remember a resolved language the page refused (stale memory), and verify direct-pi-language.test.ts fails",
    filePath: resolve(ROOT, "com.jbrick2070.fadester-for-obs.sdPlugin/ui/direct-pi.js"),
    target: "    if (!window.FadesterI18n.setResolved(language.resolved)) return;\n    rememberLanguage(language.resolved);",
    mutated: "    rememberLanguage(language.resolved);\n    if (!window.FadesterI18n.setResolved(language.resolved)) return;",
    testFile: "tests/direct-pi-language.test.ts"
  },
  {
    id: "M-11.2g",
    step: "Step L.2 (the direct settings pages)",
    description: "Redraw only the connection after a state message (no refreshControls), so the pages' drawn texts stay in the old language, and verify direct-pi-language.test.ts fails",
    filePath: resolve(ROOT, "com.jbrick2070.fadester-for-obs.sdPlugin/ui/direct-pi.js"),
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
