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
