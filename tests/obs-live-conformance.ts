// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync, writeFileSync } from "node:fs";
import { spawn, spawnSync, ChildProcess } from "node:child_process";
import { Socket } from "node:net";
import { FadesterClient } from "../src/obs/fadester-client.js";
import { FadesterStore } from "../src/state/fadester-store.js";
import { renderDialCellSvg } from "../src/gfx/svg-renderer.js";
import { FaderChangedEvent } from "../src/types/contract.js";

const OBS_ROOT = "C:\\Users\\jeffr\\OBS-Studio-33-Portable-StreamDeckFadester";
const OBS_BIN_DIR = `${OBS_ROOT}\\bin\\64bit`;
const OBS_EXE = `${OBS_BIN_DIR}\\obs64.exe`;
const OBS_WS_CONFIG_PATH = `${OBS_ROOT}\\config\\obs-studio\\plugin_config\\obs-websocket\\config.json`;
const DEFAULT_ISOLATED_PORT = 4457;

interface ObsWsConfig {
  alerts_enabled: boolean;
  auth_required: boolean;
  first_load: boolean;
  server_enabled: boolean;
  server_password: string;
  server_port: number;
}

function assertNoObsRunning(): void {
  const res = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "$p = Get-Process obs64 -ErrorAction SilentlyContinue; if ($p) { $p.Id -join ',' }"
    ],
    { encoding: "utf8" }
  );
  const pids = (res.stdout ?? "").trim();
  if (pids.length > 0) {
    throw new Error(
      `Aborting: obs64.exe is already running (PID ${pids}). Per single-OBS rule, will not launch or close portable OBS while another instance is active.`
    );
  }
}

function ensureObsWebSocketEnabled(): ObsWsConfig {
  const raw = readFileSync(OBS_WS_CONFIG_PATH, "utf8");
  const cfg = JSON.parse(raw) as ObsWsConfig;
  let modified = false;
  if (!cfg.server_enabled) {
    cfg.server_enabled = true;
    modified = true;
  }
  if (!cfg.auth_required) {
    cfg.auth_required = true;
    modified = true;
  }
  if (!cfg.server_password) {
    cfg.server_password = "fadester_live_test_pw";
    modified = true;
  }
  if (!cfg.server_port || cfg.server_port === 4455) {
    cfg.server_port = DEFAULT_ISOLATED_PORT;
    modified = true;
  }
  if (modified) {
    writeFileSync(OBS_WS_CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  }
  return cfg;
}

async function waitForTcpPort(port: number, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const sock = new Socket();
      sock.setTimeout(400);
      sock.once("connect", () => {
        sock.destroy();
        resolve(true);
      });
      sock.once("error", () => {
        sock.destroy();
        resolve(false);
      });
      sock.once("timeout", () => {
        sock.destroy();
        resolve(false);
      });
      sock.connect(port, "127.0.0.1");
    });
    if (ok) {
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for obs-websocket TCP port ${port}.`);
}

function launchPortableObs(): ChildProcess {
  const child = spawn(OBS_EXE, ["--portable", "--disable-updater"], {
    cwd: OBS_BIN_DIR,
    stdio: "ignore",
    detached: false
  });
  return child;
}

async function closePortableObs(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null || !child.pid) {
    return;
  }
  const pid = child.pid;
  const exitPromise = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });

  spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { $null = $p.CloseMainWindow() }`
    ],
    { encoding: "utf8" }
  );

  await Promise.race([
    exitPromise,
    new Promise<void>((resolve) => setTimeout(resolve, 6000))
  ]);

  if (child.exitCode === null) {
    try {
      child.kill();
    } catch {
      // Ignore
    }
  }
}

async function runLiveConformance(): Promise<void> {
  console.log("=== Live Isolated Portable OBS 33 + Midi Fadester 0.3.0 Conformance Test ===");
  assertNoObsRunning();

  const wsCfg = ensureObsWebSocketEnabled();
  console.log(
    `[CONFIG] obs_root=${OBS_ROOT}, port=${wsCfg.server_port}, auth_required=${wsCfg.auth_required}, server_enabled=${wsCfg.server_enabled} (credentials read from obs-websocket config.json)`
  );

  let obsProc: ChildProcess | null = null;
  try {
    console.log("\n[STEP 1] Launching isolated portable OBS 33...");
    obsProc = launchPortableObs();
    await waitForTcpPort(wsCfg.server_port, 15000);
    // Allow plugins & vendor API registration to finish
    await new Promise((r) => setTimeout(r, 700));
    console.log(
      `[STEP 1 PASS] Isolated portable OBS 33 listening on 127.0.0.1:${wsCfg.server_port} (PID ${obsProc.pid})`
    );

    // -------------------------------------------------------------------------
    // STEP 2: Wrong-password close 4009 (retries stop, status sentence shown)
    // -------------------------------------------------------------------------
    console.log("\n[STEP 2] Testing wrong-password close 4009 & stop-retry...");
    const badClient = new FadesterClient(
      {
        host: "127.0.0.1",
        port: wsCfg.server_port,
        password: " definitely_wrong_password_999 "
      },
      { baseReconnectMs: 50, maxReconnectMs: 100 }
    );

    const wrongPwStatus = await new Promise<ReturnType<FadesterClient["getStatus"]>>(
      (resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Timed out waiting for wrong_password status (4009)")),
          5000
        );
        badClient.on("statusChanged", (st) => {
          if (st.kind === "wrong_password") {
            clearTimeout(timer);
            resolve(st);
          }
        });
        badClient.start();
      }
    );

    await new Promise((r) => setTimeout(r, 250));
    const badAttempts = badClient.getConnectAttemptCount();
    badClient.stop();

    console.log(`  status.kind      = ${wrongPwStatus.kind}`);
    console.log(`  status.sentence  = "${wrongPwStatus.sentence}"`);
    console.log(`  connectAttempts  = ${badAttempts} (after 250 ms wait with 50 ms base backoff)`);

    if (
      wrongPwStatus.sentence !==
      "Wrong password. Check OBS Tools > WebSocket Server Settings > Show Connect Info."
    ) {
      throw new Error(`Unexpected wrong-password sentence: ${wrongPwStatus.sentence}`);
    }
    if (badAttempts !== 1) {
      throw new Error(`Expected retries to stop at 1 attempt on 4009, got ${badAttempts}`);
    }
    console.log("[STEP 2 PASS] Close 4009 detected, exact sentence shown, retries stopped at 1.");

    // -------------------------------------------------------------------------
    // STEP 3: Password auth connect & get_state (0.3.0 + build + profile fields)
    // -------------------------------------------------------------------------
    console.log("\n[STEP 3] Connecting with valid password & calling get_state...");
    const client = new FadesterClient(
      {
        host: "127.0.0.1",
        port: wsCfg.server_port,
        password: wsCfg.server_password
      },
      { baseReconnectMs: 250, maxReconnectMs: 1500 }
    );
    const store = new FadesterStore(client);

    const connectedStatus = await new Promise<ReturnType<FadesterClient["getStatus"]>>(
      (resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Timed out waiting for connected status")),
          6000
        );
        client.on("statusChanged", (st) => {
          if (st.kind === "connected") {
            clearTimeout(timer);
            resolve(st);
          }
        });
        client.start();
      }
    );

    const state = await client.getState();
    console.log(`  status.sentence  = "${connectedStatus.sentence}"`);
    console.log(
      `  get_state        = version=${state.version}, commit=${state.build?.commit ?? ""}, api_version=${state.api_version}, profile=${state.profile}, profile_tier=${state.profile_tier}, studio_mode=${state.studio_mode}, slots=${state.slots.length}`
    );
    console.log(`  device           = ${JSON.stringify(state.device)}`);

    if (!connectedStatus.sentence.startsWith("Connected: OBS 33.")) {
      throw new Error(`Unexpected connected sentence: ${connectedStatus.sentence}`);
    }
    if (state.version !== "0.3.0") {
      throw new Error(`Expected Midi Fadester 0.3.0, got ${state.version}`);
    }
    if (!state.profile || !state.profile_tier) {
      throw new Error(
        `Expected get_state to include profile and profile_tier, got profile=${state.profile}, profile_tier=${state.profile_tier}`
      );
    }
    console.log("[STEP 3 PASS] Authenticated and received 0.3.0 get_state with build, profile, and profile_tier.");

    // -------------------------------------------------------------------------
    // STEP 4: Ensure apc40mk2 + Studio Mode active (2 scenes) so crossfader T-bar is writable in 0.3.0
    // -------------------------------------------------------------------------
    console.log("\n[STEP 4] Loading apc40mk2 profile & enabling Studio Mode (2 scenes) for T-bar writability...");
    await client.loadProfile({ name: "apc40mk2" });
    const sceneList = await client.sendObsRequest("GetSceneList");
    const scenes = Array.isArray(sceneList.scenes) ? sceneList.scenes : [];
    if (scenes.length < 2) {
      await client
        .sendObsRequest("CreateScene", { sceneName: "Fadester Live Scene B" })
        .catch(() => {});
    }
    await client.sendObsRequest("SetStudioModeEnabled", {
      studioModeEnabled: true
    });
    await new Promise((r) => setTimeout(r, 150));

    const studioState = await client.getState();
    const crossfaderReady = studioState.slots.find((s) => s.id === "crossfader");
    console.log(
      `  studio_mode      = ${studioState.studio_mode}, crossfader.available=${crossfaderReady?.available}, reason="${crossfaderReady?.reason ?? ""}"`
    );
    if (!crossfaderReady || !crossfaderReady.available) {
      throw new Error(
        `Expected crossfader to be available in Studio Mode, got ${JSON.stringify(crossfaderReady)}`
      );
    }
    console.log("[STEP 4 PASS] apc40mk2 loaded and Studio Mode active; crossfader is available.");

    // -------------------------------------------------------------------------
    // STEP 5: nudge_fader on crossfader + receive fader_changed event
    // -------------------------------------------------------------------------
    console.log(
      "\n[STEP 5] Resetting crossfader to 0.0, then calling nudge_fader({ slot: 'crossfader', delta: 0.15 })..."
    );
    await client.setFaderValue({ slot: "crossfader", value: 0.0 });
    await new Promise((r) => setTimeout(r, 60));

    const receivedEvents: FaderChangedEvent[] = [];
    const onFaderChanged = (ev: FaderChangedEvent): void => {
      if (ev.slot === "crossfader") {
        receivedEvents.push(ev);
      }
    };
    client.on("faderChanged", onFaderChanged);

    const nudgeRes = await client.nudgeFader({ slot: "crossfader", delta: 0.15 });
    await new Promise((r) => setTimeout(r, 100));

    console.log(`  nudge_fader resp = ${JSON.stringify(nudgeRes)}`);
    console.log(`  fader_changed ev = ${JSON.stringify(receivedEvents[0])}`);

    if (nudgeRes.slot !== "crossfader" || Math.abs(nudgeRes.value - 0.15) > 0.001) {
      throw new Error(`Unexpected nudge_fader response: ${JSON.stringify(nudgeRes)}`);
    }
    if (receivedEvents.length === 0) {
      throw new Error("Expected at least one fader_changed event after nudge_fader");
    }
    console.log("[STEP 5 PASS] nudge_fader on crossfader succeeded and emitted fader_changed event.");

    // -------------------------------------------------------------------------
    // STEP 6: auto_fade on crossfader + receive auto_fade fader_changed events
    // -------------------------------------------------------------------------
    console.log("\n[STEP 6] Calling auto_fade({ slot: 'crossfader', to: 0.85, ms: 300 })...");
    receivedEvents.length = 0;
    const autoFadeRes = await client.autoFade({
      slot: "crossfader",
      to: 0.85,
      ms: 300
    });
    await new Promise((r) => setTimeout(r, 450));

    const postFadeState = await client.getState();
    const postFadeCrossfader = postFadeState.slots.find((s) => s.id === "crossfader");
    const autoFadeEvents = receivedEvents.filter((e) => e.origin === "auto_fade");

    console.log(`  auto_fade resp   = ${JSON.stringify(autoFadeRes)}`);
    console.log(
      `  auto_fade events = received ${autoFadeEvents.length} events; last=${JSON.stringify(autoFadeEvents.at(-1))}`
    );
    console.log(`  post-fade value  = ${postFadeCrossfader?.value}`);

    if (autoFadeRes.slot !== "crossfader") {
      throw new Error(`Unexpected auto_fade response: ${JSON.stringify(autoFadeRes)}`);
    }
    if (autoFadeEvents.length === 0) {
      throw new Error("Expected fader_changed events with origin='auto_fade'");
    }
    if (!postFadeCrossfader || Math.abs(postFadeCrossfader.value - 0.85) > 0.02) {
      throw new Error(
        `Expected crossfader value ~0.85 after auto_fade, got ${postFadeCrossfader?.value}`
      );
    }
    await client.setFaderValue({ slot: "crossfader", value: 0.0 });
    client.off("faderChanged", onFaderChanged);
    console.log(
      "[STEP 6 PASS] auto_fade completed to 0.85 and emitted fader_changed (origin='auto_fade')."
    );

    // -------------------------------------------------------------------------
    // STEP 7: Live 0.3.0 profile switch (nanokontrol2 -> no crossfader, no master)
    // -------------------------------------------------------------------------
    console.log(
      "\n[STEP 7] Switching live to 'nanokontrol2' (no crossfader, no master) and checking state_changed & SVG..."
    );
    const stateChangedPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Timed out waiting for store changed after load_profile")),
        4000
      );
      const onStoreChanged = (): void => {
        if (store.getProfile() === "nanokontrol2") {
          clearTimeout(timer);
          store.off("changed", onStoreChanged);
          resolve();
        }
      };
      store.on("changed", onStoreChanged);
    });

    const loadNanoRes = await client.loadProfile({ name: "nanokontrol2" });
    await stateChangedPromise;

    const nanoCrossfader = store.getSlot("crossfader");
    const nanoMaster = store.getSlot("master");
    const nanoCrossfaderSvg = renderDialCellSvg({
      status: store.getStatus(),
      slot: nanoCrossfader,
      slotId: "crossfader"
    });

    console.log(`  load_profile res = ${JSON.stringify(loadNanoRes)}`);
    console.log(
      `  store profile    = ${store.getProfile()} (${store.getProfileTier()}), display="${store.getProfileDisplayName()}"`
    );
    console.log(
      `  crossfader slot  = target_mode=${nanoCrossfader?.target_mode}, available=${nanoCrossfader?.available}, reason="${nanoCrossfader?.reason}"`
    );
    console.log(
      `  master slot      = target_mode=${nanoMaster?.target_mode}, available=${nanoMaster?.available}, reason="${nanoMaster?.reason}"`
    );

    if (
      !nanoCrossfader ||
      nanoCrossfader.available !== false ||
      nanoCrossfader.reason !== "Not used. Click to set up."
    ) {
      throw new Error(
        `Expected nanokontrol2 crossfader disabled with verbatim reason, got ${JSON.stringify(nanoCrossfader)}`
      );
    }
    if (
      !nanoMaster ||
      nanoMaster.available !== false ||
      nanoMaster.reason !== "Not used. Click to set up."
    ) {
      throw new Error(
        `Expected nanokontrol2 master disabled with verbatim reason, got ${JSON.stringify(nanoMaster)}`
      );
    }
    if (!nanoCrossfaderSvg.includes("Not used. Click to set up.")) {
      throw new Error("Expected crossfader dial SVG to render verbatim 'Not used. Click to set up.'");
    }

    // Restore apc40mk2
    await client.loadProfile({ name: "apc40mk2" });
    await new Promise((r) => setTimeout(r, 150));
    console.log(
      "[STEP 7 PASS] Live state_changed updated store & dial SVG for disabled crossfader/master without restart, then restored apc40mk2."
    );

    // -------------------------------------------------------------------------
    // STEP 8: Reconnect automatically after OBS restarts (D-2)
    // -------------------------------------------------------------------------
    console.log(
      "\n[STEP 8] Closing isolated portable OBS 33 to test disconnect & automatic reconnect on restart..."
    );
    const disconnectedPromise = new Promise<ReturnType<FadesterClient["getStatus"]>>(
      (resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Timed out waiting for obs_unreachable status")),
          8000
        );
        const onStatus = (st: ReturnType<FadesterClient["getStatus"]>): void => {
          if (st.kind === "obs_unreachable") {
            clearTimeout(timer);
            client.off("statusChanged", onStatus);
            resolve(st);
          }
        };
        client.on("statusChanged", onStatus);
      }
    );

    await closePortableObs(obsProc);
    obsProc = null;
    const unreachableStatus = await disconnectedPromise;
    console.log(`  on OBS exit      = "${unreachableStatus.sentence}"`);

    assertNoObsRunning();

    const reconnectedPromise = new Promise<ReturnType<FadesterClient["getStatus"]>>(
      (resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Timed out waiting for automatic reconnect after OBS restart")),
          15000
        );
        const onStatus = (st: ReturnType<FadesterClient["getStatus"]>): void => {
          if (st.kind === "connected") {
            clearTimeout(timer);
            client.off("statusChanged", onStatus);
            resolve(st);
          }
        };
        client.on("statusChanged", onStatus);
      }
    );

    console.log("  Relaunching isolated portable OBS 33...");
    obsProc = launchPortableObs();
    const reconnectedStatus = await reconnectedPromise;
    console.log(`  on OBS restart   = "${reconnectedStatus.sentence}"`);
    console.log(`  store slot count = ${store.getSlots().length}`);
    console.log(
      "[STEP 8 PASS] Client automatically reconnected and re-synced state after OBS restart."
    );

    client.stop();
    console.log("\n=== ALL LIVE OBS 33 + MIDI FADESTER 0.3.0 CONFORMANCE CHECKS PASSED ===");
  } finally {
    await closePortableObs(obsProc);
  }
}

void runLiveConformance().catch((err) => {
  console.error("\n[LIVE CONFORMANCE FAILED]", err);
  process.exit(1);
});
