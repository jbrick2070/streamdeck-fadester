// SPDX-License-Identifier: GPL-2.0-or-later
export type Json = Record<string, unknown>;
export type ObsCall = (type: string, data?: Json) => Promise<Json>;
export interface Owned { name: string; uuid: string }
export interface ObservedInput extends Owned { kind?: unknown; caps?: unknown }
export const MAC_COLOR_FIXTURE = Object.freeze({ uuid: "3be2aa1c-48e3-4d4d-8bd3-898664a6e1cc", name: "Color", kind: "color_source_v3", caps: 32777 });
export interface SceneItem { sceneUuid: string; itemId: number; sourceUuid: string; sourceName: string }
export interface View { studio: boolean; program: string; preview: string }
export interface ExpectedView { studio: boolean; program: string[]; preview: string[] }

export class ObsRequestFailure extends Error {
  constructor(readonly request: string, readonly code: number) { super(`OBS ${request} failed (${code})`); }
}

/** Events can arrive during any awaited RPC. Do not let a prior guard authorize a later write. */
export function checkedCall(call: ObsCall, check: () => void): ObsCall {
  return async (type, data) => { check(); try { return await call(type, data); } finally { check(); } };
}

export function liveConfig(platform: string, env: NodeJS.ProcessEnv): { port: number; password: string; mix: boolean; allowColorFixture: boolean } {
  if (platform !== "darwin") throw new Error("This live harness runs only on macOS; no OBS connection was attempted");
  if (env.FADESTER_MAC_LIVE !== "1") throw new Error("Set FADESTER_MAC_LIVE=1 to opt into disposable local OBS fixtures");
  const port = Number(env.FADESTER_MAC_OBS_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("FADESTER_MAC_OBS_PORT must name the local test OBS port");
  const password = env.FADESTER_MAC_OBS_PASSWORD;
  if (!password) throw new Error("FADESTER_MAC_OBS_PASSWORD is required; authentication must remain enabled");
  const mix = env.FADESTER_MAC_MIX === "1", allowColorFixture = env.FADESTER_MAC_MIX_ALLOW_COLOR_FIXTURE === "1";
  if (allowColorFixture && !mix) throw new Error("FADESTER_MAC_MIX_ALLOW_COLOR_FIXTURE requires the explicit whole-mix test opt-in");
  return { port, password, mix, allowColorFixture };
}

export async function requireIdle(call: ObsCall): Promise<void> {
  for (const type of ["GetStreamStatus", "GetRecordStatus", "GetReplayBufferStatus", "GetVirtualCamStatus"]) {
    let state: Json;
    try { state = await call(type); }
    catch (error) {
      // OBS RequestHandler_Outputs.cpp: GetReplayBufferStatus returns InvalidResourceState
      // (604) specifically when obs_frontend_get_replay_buffer_output() is null.
      // Never extend this exception to another request or a generic/parsed error string.
      if (type === "GetReplayBufferStatus" && error instanceof ObsRequestFailure && error.request === type && error.code === 604) continue;
      throw error;
    }
    if (state.outputActive !== false) throw new Error(`Refusing live writes: ${type} is active or unknown`);
  }
}

export function requireExpectedView(actual: View, expected: ExpectedView): void {
  if (actual.studio !== expected.studio || !expected.program.includes(actual.program) ||
      (expected.studio && !expected.preview.includes(actual.preview))) {
    throw new Error("Program, Preview or Studio Mode changed outside the expected fixture state; preserving operator state");
  }
}

/** Validate the complete plan before removing any input or parent scene. */
export function requireUnchangedFixtures(
  ownedScenes: readonly Owned[], ownedInputs: readonly Owned[], ownedItems: readonly SceneItem[],
  currentScenes: readonly Owned[], currentInputs: readonly Owned[], currentItems: readonly SceneItem[], prefix: string,
  detachedInputs: ReadonlySet<string> = new Set()
): void {
  if (removable(ownedScenes, currentScenes, prefix).length !== ownedScenes.length) throw new Error("A fixture was removed, renamed or replaced; preserving all remaining fixtures");
  for (const input of ownedInputs) {
    // Detaching its final owned scene item can destroy the input immediately.
    // Only absence is allowed: a renamed/replaced source or a remaining item is not.
    const absentAfterDetach = input.uuid.length > 0 && input.name.startsWith(prefix) && detachedInputs.has(input.uuid) && !ownedItems.some((item) => item.sourceUuid === input.uuid) &&
      !currentInputs.some((actual) => actual.uuid === input.uuid || actual.name === input.name);
    if (!absentAfterDetach && removable([input], currentInputs, prefix).length !== 1) throw new Error("A fixture was removed, renamed or replaced; preserving all remaining fixtures");
  }
  const same = (a: SceneItem, b: SceneItem): boolean => a.sceneUuid === b.sceneUuid && a.itemId === b.itemId && a.sourceUuid === b.sourceUuid && a.sourceName === b.sourceName;
  const inOwnedScene = currentItems.filter((item) => ownedScenes.some((scene) => scene.uuid === item.sceneUuid));
  if (inOwnedScene.length !== ownedItems.length || ownedItems.some((item) => !inOwnedScene.some((actual) => same(item, actual)))) {
    throw new Error("Fixture scene contents changed; refusing to remove a parent scene or its inputs");
  }
  const ownedSources = new Set([...ownedInputs, ...ownedScenes].map((item) => item.uuid));
  if (currentItems.some((item) => ownedSources.has(item.sourceUuid) && !ownedItems.some((own) => same(own, item)))) {
    throw new Error("A fixture is referenced elsewhere in OBS; preserving the new reference and its source");
  }
}

interface InputRemoval {
  preflight: () => Promise<unknown>;
  write: (type: string, data: Json) => Promise<Json>;
  inputs: () => Promise<Owned[]>;
  detached: (item: SceneItem) => void;
  waitAbsent: () => Promise<void>;
}

/** RemoveInput alone leaves inactive scene-item references alive in OBS 33.
 * Explicitly detach the exact owned items before waiting for source destruction.
 * Mutations are never retried, including after an uncertain transport failure.
 */
export async function removeOwnedInput(input: Owned, items: readonly SceneItem[], io: InputRemoval): Promise<void> {
  if (!input.uuid || !items.length || items.some((item) => item.sourceUuid !== input.uuid || item.sourceName !== input.name || !Number.isInteger(item.itemId))) {
    throw new Error("Input removal has no exact owned scene-item plan");
  }
  for (const item of items) {
    await io.preflight();
    await io.write("RemoveSceneItem", { sceneUuid: item.sceneUuid, sceneItemId: item.itemId });
    io.detached(item);
  }
  await io.preflight();
  const inputs = await io.inputs();
  const present = inputs.find((actual) => actual.uuid === input.uuid);
  if (present) {
    if (present.name !== input.name) throw new Error("Detached input was renamed; preserving it");
    await io.preflight();
    try { await io.write("RemoveInput", { inputUuid: input.uuid }); }
    catch (error) {
      // The last item can release its source between the read and this request.
      // Only OBS's exact ResourceNotFound response may proceed to absence proof.
      if (!(error instanceof ObsRequestFailure && error.request === "RemoveInput" && error.code === 600)) throw error;
    }
  } else if (inputs.some((actual) => actual.name === input.name)) {
    throw new Error("Detached input was replaced; preserving it");
  }
  await io.waitAbsent();
}

/** Both name and UUID must still match; a replacement or operator rename is not ours to remove. */
export function removable(owned: readonly Owned[], current: readonly Owned[], prefix: string): Owned[] {
  return owned.filter((item) => item.name.startsWith(prefix) && item.uuid.length > 0 &&
    current.some((actual) => actual.name === item.name && actual.uuid === item.uuid));
}

export function requireOnlyFixtureInputs(current: readonly ObservedInput[], owned: readonly Owned[], allowColorFixture = false): void {
  if (allowColorFixture) {
    const matches = current.filter((input) => input.uuid === MAC_COLOR_FIXTURE.uuid);
    const input = matches[0];
    // Fixed developer-fixture exception, not a general non-audio allowlist.
    // OBS_SOURCE_AUDIO=2, OBS_SOURCE_COMPOSITE=64; require exact known caps too.
    if (matches.length !== 1 || input.name !== MAC_COLOR_FIXTURE.name || input.kind !== MAC_COLOR_FIXTURE.kind ||
        typeof input.caps !== "number" || !Number.isInteger(input.caps) || input.caps !== MAC_COLOR_FIXTURE.caps || (input.caps & (2 | 64)) !== 0) {
      throw new Error("The explicitly allowed Color fixture changed or has unverified/audio/composite capabilities");
    }
  }
  if (!current.length || current.some((input) => !(allowColorFixture && input.uuid === MAC_COLOR_FIXTURE.uuid) &&
      !owned.some((item) => item.name === input.name && item.uuid === input.uuid))) {
    throw new Error("Mix test requires an OBS collection containing only this run's inputs, including global audio devices");
  }
}

/** A muted, local WAV fixture avoids microphone/system-capture permissions and external media. */
export function silentWav(): Buffer {
  const dataBytes = 48000 * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + dataBytes, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(dataBytes, 40);
  return wav;
}
