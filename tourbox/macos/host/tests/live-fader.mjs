// SPDX-License-Identifier: GPL-2.0-or-later
// Explicit rental-fixture rehearsal. Observer requests are mechanically GET-only.
import {readFile, writeFile, mkdtemp, rm} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {spawn, execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {pathToFileURL} from 'node:url';

const expected = Object.freeze({pid: 54303, port: 4455, collection: 'Untitled',
  program: '48304718-4337-4fad-9d62-45142dd70a8b', preview: 'a28977bf-f521-4cb0-b06e-eb97b11a3614',
  input: '3be2aa1c-48e3-4d4d-8bd3-898664a6e1cc', transition: 'de66db5c-e44d-42ca-b6f7-755165d1886c'});
const binary = '/Users/rentamac/Developer/fadester-mac-host/tourbox/macos/host/publish/FadesterMacHost';
const native = '/Users/rentamac/Developer/fadester-mac-native-fixed/build/Fadester Native Slider Experimental.app';
const fail = message => { throw new Error(message); };
function requireThat(value, message) { if (!value) fail(message); }
const stable = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);

function guard(snapshot, partial = false, settling = false) {
  requireThat(snapshot.version.obsVersion === '33.0.1', 'Unexpected OBS version.');
  requireThat(snapshot.collection.currentSceneCollectionName === expected.collection, 'Scene collection changed.');
  requireThat(snapshot.studio.studioModeEnabled === true, 'Studio Mode is not enabled.');
  requireThat(snapshot.stream.outputActive === false && snapshot.record.outputActive === false &&
    snapshot.virtualCamera.outputActive === false && snapshot.replay.outputActive === false, 'An output is active.');
  const list = snapshot.scenes;
  requireThat(list.scenes.length === 2 && list.scenes.some(s => s.sceneUuid === expected.program && s.sceneName === 'Scene') &&
    list.scenes.some(s => s.sceneUuid === expected.preview && s.sceneName === 'Scene 2'), 'Owned scene identities changed.');
  requireThat(list.currentPreviewSceneUuid === expected.preview && (partial
    ? [expected.program, expected.preview].includes(list.currentProgramSceneUuid)
    : list.currentProgramSceneUuid === expected.program), 'Program or Preview changed.');
  requireThat(snapshot.transition.transitionUuid === expected.transition && snapshot.transition.transitionKind === 'fade_transition' &&
    snapshot.transition.transitionName === 'Fade' && snapshot.transition.transitionDuration === 300, 'Expected Fade changed.');
  requireThat(!snapshot.programOverride.transitionName && !snapshot.previewOverride.transitionName, 'A scene transition override is present.');
  requireThat(snapshot.inputs.inputs.length === 1 && snapshot.inputs.inputs[0].inputUuid === expected.input &&
    snapshot.inputs.inputs[0].inputName === 'Color' && snapshot.inputs.inputs[0].inputKind === 'color_source_v3', 'Owned color input changed.');
  const items = snapshot.previewItems.sceneItems;
  requireThat(snapshot.programItems.sceneItems.length === 0 && items.length === 1 && items[0].sceneItemId === 1 &&
    items[0].sourceUuid === expected.input && items[0].sourceName === 'Color' && items[0].sceneItemEnabled === true &&
    (items[0].isGroup === false || items[0].isGroup === null), 'Owned scene items changed.');
  const cursor = snapshot.cursor.transitionCursor;
  requireThat(Number.isFinite(cursor) && (partial ? cursor >= (settling ? 0 : .03) && cursor <= .07 : cursor === 0 || cursor === 1),
    partial ? 'Independent renderer cursor is outside the 5% bound.' : 'A transition is already active.');
}
async function waitForSettled(read, {now = () => performance.now(), pause = ms => new Promise(resolve => setTimeout(resolve, ms)), timeout = 2500} = {}) {
  const deadline = now() + timeout; let previous = null;
  while (now() < deadline) {
    const sample = await read();
    requireThat(sample.nativeTick === 51, 'Native position changed during renderer settling.');
    requireThat(Number.isFinite(sample.cursor) && sample.cursor >= 0 && sample.cursor <= .07, 'Renderer left the bounded partial transition.');
    requireThat(now() < deadline, 'Renderer settling deadline exceeded.');
    if (sample.cursor >= .03 && previous !== null && Math.abs(sample.cursor - previous) <= .001) return sample;
    previous = sample.cursor >= .03 ? sample.cursor : null;
    await pause(50);
  }
  fail('Renderer did not settle within the bounded read-only wait.');
}
function staticState(snapshot) {
  const value = structuredClone(snapshot);
  delete value.cursor; delete value.scenes.currentProgramSceneUuid; delete value.scenes.currentProgramSceneName;
  // Output counters/timecodes advance while stopped on some OBS builds; identity checks use outputActive.
  for (const name of ['stream', 'record', 'virtualCamera', 'replay']) value[name] = {outputActive: value[name].outputActive};
  return stable(value);
}
function listenerIdentity() {
  const text = execFileSync('/usr/sbin/lsof', ['-nP', '-iTCP:4455', '-sTCP:LISTEN', '-Ffpn'], {encoding: 'utf8', timeout: 3000});
  let pid = null, descriptor = false, named = false;
  const owners = new Set();
  for (const line of text.trim().split('\n')) {
    if (/^p[1-9][0-9]*$/.test(line)) {
      requireThat(pid === null || descriptor && named, 'Incomplete listener record.'); pid = Number(line.slice(1)); descriptor = false; named = false;
    } else if (/^f[0-9]+$/.test(line)) {
      requireThat(pid !== null && (!descriptor || named), 'Invalid listener descriptor.'); descriptor = true; named = false;
    } else if (line.startsWith('n')) {
      requireThat(pid !== null && descriptor && !named && ['*:4455', '127.0.0.1:4455', '[::1]:4455', '[::]:4455', '0.0.0.0:4455'].includes(line.slice(1)), 'Unexpected listener endpoint.');
      owners.add(pid); named = true;
    } else fail('Unknown listener field.');
  }
  requireThat(descriptor && named && owners.size === 1 && owners.has(expected.pid), 'The owned OBS process changed; review a new fixture explicitly.');
}
async function connect(password, allowZeroRelease = false) {
  const ws = new WebSocket('ws://127.0.0.1:4455', 'obswebsocket.json');
  const pending = new Map(); let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const timer = setTimeout(() => readyReject(new Error('Observer authentication timed out.')), 5000);
  ws.addEventListener('message', event => {
    try {
      const packet = JSON.parse(String(event.data));
      if (packet.op === 0) {
        const auth = packet.d.authentication;
        requireThat(typeof auth?.salt === 'string' && typeof auth?.challenge === 'string', 'Authenticated OBS v5 is required.');
        const hash = text => createHash('sha256').update(text).digest('base64');
        ws.send(JSON.stringify({op: 1, d: {rpcVersion: 1, eventSubscriptions: 0,
          authentication: hash(hash(password + auth.salt) + auth.challenge)}}));
      } else if (packet.op === 2) readyResolve();
      else if (packet.op === 7) {
        const item = pending.get(packet.d.requestId); if (!item) return;
        pending.delete(packet.d.requestId); clearTimeout(item.timer);
        if (packet.d.requestStatus.result) item.resolve(packet.d.responseData ?? {});
        else item.reject(Object.assign(new Error('OBS read refused: ' + item.type), {code: packet.d.requestStatus.code}));
      }
    } catch (error) { readyReject(error); }
  });
  ws.addEventListener('error', () => readyReject(new Error('Observer connection failed.')));
  ws.addEventListener('close', () => {
    readyReject(new Error('Observer disconnected.'));
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Observer disconnected.')); }
    pending.clear();
  });
  try { await ready; } catch (error) { ws.close(); throw error; } finally { clearTimeout(timer); }
  let released = false;
  function request(type, data = {}) {
      requireThat(ws.readyState === WebSocket.OPEN, 'Observer is disconnected.');
      return new Promise((resolve, reject) => {
        const id = randomUUID();
        const timeout = setTimeout(() => { pending.delete(id); reject(new Error('OBS read timed out: ' + type)); }, 2500);
        pending.set(id, {resolve, reject, timer: timeout, type});
        ws.send(JSON.stringify({op: 6, d: {requestId: id, requestType: type, requestData: data}}));
      });
  }
  return {
    call(type, data = {}) {
      requireThat(type.startsWith('Get'), 'Observer rejects every mutating request.');
      return request(type, data);
    },
    releaseZeroOnce() {
      requireThat(allowZeroRelease && !released, 'Zero-release capability is absent or already used.');
      released = true;
      return request('SetTBarPosition', {position: 0, release: true});
    }, close() { ws.close(); }
  };
}
async function snapshot(obs) {
  const get = (type, args) => obs.call(type, args);
  const names = ['version', 'collection', 'studio', 'stream', 'record', 'virtualCamera', 'scenes', 'transition', 'cursor', 'inputs',
    'programItems', 'previewItems', 'programOverride', 'previewOverride', 'settings', 'defaults', 'transform'];
  const requests = [get('GetVersion'), get('GetSceneCollectionList'), get('GetStudioModeEnabled'), get('GetStreamStatus'), get('GetRecordStatus'),
    get('GetVirtualCamStatus'), get('GetSceneList'), get('GetCurrentSceneTransition'), get('GetCurrentSceneTransitionCursor'), get('GetInputList'),
    get('GetSceneItemList', {sceneUuid: expected.program}), get('GetSceneItemList', {sceneUuid: expected.preview}),
    get('GetSceneSceneTransitionOverride', {sceneUuid: expected.program}), get('GetSceneSceneTransitionOverride', {sceneUuid: expected.preview}),
    get('GetInputSettings', {inputUuid: expected.input}), get('GetInputDefaultSettings', {inputKind: 'color_source_v3'}),
    get('GetSceneItemTransform', {sceneUuid: expected.preview, sceneItemId: 1})];
  const result = Object.fromEntries((await Promise.all(requests)).map((value, i) => [names[i], value]));
  try { result.replay = await get('GetReplayBufferStatus'); }
  catch (error) { if (error.code !== 604) throw error; result.replay = {outputActive: false, unavailable: true}; }
  return result;
}
function launch(config, password) {
  const env = {...process.env, FADESTER_OBS_PASSWORD: password}; delete env.FADESTER_MAC_OBS_PASSWORD;
  const child = spawn(binary, ['--run', '--no-mix-provider', '--config', config, '--native-app', native], {stdio: ['pipe', 'pipe', 'pipe'], env});
  const pending = new Map(); let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const timer = setTimeout(() => rejectReady(new Error('Host did not reach READY.')), 12000);
  let exited = false, sawDisarmed = false, sawStopped = false, finish;
  const finished = new Promise(resolve => { finish = resolve; });
  child.on('close', (code, signal) => { exited = true; finish({code, signal});
    clearTimeout(timer); rejectReady(new Error('Host exited before READY.'));
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Host exited with command unconfirmed.')); }
    pending.clear(); });
  for (const stream of [child.stdout, child.stderr]) createInterface({input: stream}).on('line', raw => {
    const line = raw.replaceAll(password, '[redacted]');
    if (/^READY [1-9][0-9]*$/.test(line)) { clearTimeout(timer); resolveReady(); }
    if (/^DISARMED [1-9][0-9]*$/.test(line)) sawDisarmed = true;
    if (line === 'STOPPED' || line.startsWith('STOPPED:')) sawStopped = true;
    if (line.startsWith('ERROR:')) rejectReady(new Error(line));
    if (/^(READY|RESULT|REFUSED|ERROR|DISARMED|STOPPED)/.test(line)) console.log(line.slice(0, 1000));
    const match = /^(RESULT|REFUSED) ([a-zA-Z.]+): (.*)$/.exec(line);
    if (match && pending.has(match[2])) {
      const item = pending.get(match[2]); pending.delete(match[2]); clearTimeout(item.timer);
      match[1] === 'RESULT' ? item.resolve(match[3]) : item.reject(new Error('Host refused ' + match[2] + ': ' + match[3]));
    }
  });
  child.on('error', error => { exited = true; finish({code: -1, signal: null}); rejectReady(new Error('Host launch failed: ' + error.message)); });
  child.stdin.on('error', () => {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Host stdin closed with command unconfirmed.')); }
    pending.clear();
  });
  return {ready,
    command(action) { return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { pending.delete(action); reject(new Error('Host command unconfirmed: ' + action)); }, 7000);
      pending.set(action, {resolve, reject, timer: timeout}); child.stdin.write('action ' + action + '\n');
    }); },
    async close() {
      clearTimeout(timer);
      if (!exited && !child.stdin.destroyed) { child.stdin.write('quit\n'); child.stdin.end(); }
      const stop = setTimeout(() => { if (!exited) child.kill('SIGTERM'); }, 3000);
      const force = setTimeout(() => { if (!exited) child.kill('SIGKILL'); }, 6000);
      try { return {...await finished, sawDisarmed, sawStopped}; } finally { clearTimeout(stop); clearTimeout(force); }
    }
  };
}
/** Ask the native helper for one READ. Resolves the tick; rejects on refusal, timeout or the helper ending first; always ends the helper. */
export async function readNativeOnce(helper, {timeoutMs = 5000, killAfterMs = 1000} = {}) {
  const closed = new Promise(resolve => helper.once('close', resolve));
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Native READ timed out.')), timeoutMs);
      const lines = createInterface({input: helper.stdout});
      lines.once('line', line => { clearTimeout(timer); lines.close(); /^OK (?:[0-9]{1,4})$/.test(line) ? resolve(Number(line.slice(3))) : reject(new Error('Native READ refused.')); });
      helper.once('error', () => { clearTimeout(timer); reject(new Error('Native reader did not launch.')); });
      closed.then(() => { clearTimeout(timer); reject(new Error('Native reader exited before READ.')); });
      helper.stdin.on('error', () => {});
      helper.stdin.write('READ\n');
    });
  } finally {
    helper.stdin.end();
    const kill = setTimeout(() => helper.kill('SIGTERM'), killAfterMs);
    let giveUp;
    await Promise.race([closed, new Promise(resolve => { giveUp = setTimeout(resolve, killAfterMs + 2000); })]);
    clearTimeout(kill); clearTimeout(giveUp);
  }
}
async function main() {
  const [mode, receiptPath] = process.argv.slice(2);
  requireThat(['--preflight', '--execute', '--inspect'].includes(mode) && receiptPath && process.argv.length === 4,
    'Use --preflight RECEIPT, --inspect RECEIPT or --execute REVIEWED_RECEIPT. No action was started.');
  requireThat(process.platform === 'darwin', 'This is a Mac rental-fixture test only.');
  const saved = JSON.parse(await readFile(join(homedir(), 'Library/Application Support/obs-studio/plugin_config/obs-websocket/config.json'), 'utf8'));
  requireThat(saved.server_enabled === true && saved.auth_required === true && saved.server_port === expected.port &&
    typeof saved.server_password === 'string' && saved.server_password.length > 0, 'Expected authenticated local OBS configuration.');
  listenerIdentity();
  const obs = await connect(saved.server_password); let host, directory, forwardAccepted = false, restored = false;
  try {
    const before = await snapshot(obs); const beforeAt = new Date().toISOString();
    if (mode === '--inspect') {
      const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
      const env = {...process.env}; delete env.FADESTER_OBS_PASSWORD; delete env.FADESTER_MAC_OBS_PASSWORD;
      const helper = spawn(join(native, 'Contents/MacOS/FadesterNativeSlider'), ['--stdio', '--obs-pid', String(expected.pid), '--obs-port', String(expected.port)], {stdio: ['pipe', 'pipe', 'pipe'], env});
      const tick = await readNativeOnce(helper);
      await new Promise(resolve => setTimeout(resolve, 250));
      const second = await snapshot(obs); const secondAt = new Date().toISOString(); listenerIdentity();
      const unchanged = staticState(before) === staticState(receipt.snapshot) && staticState(second) === staticState(receipt.snapshot);
      const correctPair = [expected.program, expected.preview].includes(second.scenes.currentProgramSceneUuid) && second.scenes.currentPreviewSceneUuid === expected.preview;
      console.log(JSON.stringify({inspectionOnly: true, fixtureUnchanged: unchanged, correctPair, nativeTick: tick,
        samples: [{at: beforeAt, cursor: before.cursor.transitionCursor}, {at: secondAt, cursor: second.cursor.transitionCursor}],
        studio: second.studio.studioModeEnabled, stream: second.stream.outputActive, record: second.record.outputActive,
        virtualCamera: second.virtualCamera.outputActive, replay: second.replay.outputActive,
        program: second.scenes.currentProgramSceneUuid, preview: second.scenes.currentPreviewSceneUuid,
        restorationVerified: unchanged && correctPair && tick === 0 && second.scenes.currentProgramSceneUuid === expected.program && [0, 1].includes(second.cursor.transitionCursor),
        recoveryInspection: unchanged && correctPair && tick === 51 && second.cursor.transitionCursor > 0 && second.cursor.transitionCursor < 1 ? 'GO for reviewed recovery' : 'MISMATCH'}, null, 2));
      return;
    }
    guard(before);
    if (mode === '--preflight') {
      await writeFile(receiptPath, JSON.stringify({createdAt: new Date().toISOString(), expected, snapshot: before}, null, 2), {flag: 'wx', mode: 0o600});
      console.log(JSON.stringify({preflight: 'PASS', collection: expected.collection, program: 'Scene', preview: 'Scene 2',
        cursor: before.cursor.transitionCursor, input: before.settings, defaults: before.defaults, transform: before.transform}, null, 2));
      return;
    }
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    requireThat(stable(receipt.expected) === stable(expected) && Date.now() - Date.parse(receipt.createdAt) >= 0 &&
      Date.now() - Date.parse(receipt.createdAt) < 15 * 60 * 1000, 'Receipt is invalid or expired; review a fresh preflight.');
    guard(receipt.snapshot);
    requireThat(staticState(before) === staticState(receipt.snapshot), 'Fixture changed since reviewed preflight.');
    directory = await mkdtemp(join(tmpdir(), 'fadester-host-five-percent-'));
    const config = join(directory, 'config.json');
    await writeFile(config, JSON.stringify({host: '127.0.0.1', port: expected.port, mixEnabled: false, faderStep: .05}), {mode: 0o600});
    host = launch(config, saved.server_password); await host.ready;
    requireThat(await host.command('host.native.status') === 'Native slider: 0 / 1023', 'Native bar is not at zero.');
    const immediatelyBefore = await snapshot(obs); guard(immediatelyBefore); listenerIdentity();
    requireThat(staticState(immediatelyBefore) === staticState(before), 'Fixture changed before forward.');
    await host.command('fader.forward'); forwardAccepted = true;
    const settled = await waitForSettled(async () => {
      const nativeResult = await host.command('host.native.status');
      const sample = await snapshot(obs); guard(sample, true, true); listenerIdentity();
      requireThat(staticState(sample) === staticState(before), 'Fixture changed during settling; no cancel sent.');
      return {nativeTick: nativeResult === 'Native slider: 51 / 1023' ? 51 : -1, cursor: sample.cursor.transitionCursor, snapshot: sample};
    });
    const partial = settled.snapshot; guard(partial, true);
    requireThat(await host.command('host.native.status') === 'Native slider: 51 / 1023', 'Native position changed before cancel.');
    console.log('PARTIAL VERIFIED: native tick51 and independent renderer cursor ' + partial.cursor.transitionCursor + '.');
    await host.command('fader.cancel');
    requireThat(await host.command('host.native.status') === 'Native slider: 0 / 1023', 'Native bar did not return to zero.');
    const after = await snapshot(obs); guard(after); listenerIdentity();
    requireThat(staticState(after) === staticState(before), 'Fixture metadata changed after cancel.');
    restored = true;
    const termination = await host.close(); host = null;
    requireThat(termination.code === 0 && termination.signal === null && termination.sawDisarmed && termination.sawStopped,
      'Host did not confirm a clean disarmed shutdown.');
    const shutdownState = await snapshot(obs); guard(shutdownState);
    requireThat(staticState(shutdownState) === staticState(before), 'Fixture changed during host shutdown.');
    console.log('PASS: single 5% forward and cancel; native0→51→0, independent cursor verified, original Program/Preview and source settings restored.');
  } catch (error) {
    console.error('TEST STOPPED: ' + String(error.message).replaceAll(saved.server_password, '[redacted]'));
    if (mode === '--execute') {
      try { const state = await snapshot(obs); console.error(JSON.stringify({inspectionOnly: true, program: state.scenes.currentProgramSceneUuid,
        preview: state.scenes.currentPreviewSceneUuid, cursor: state.cursor.transitionCursor, forwardAccepted, restored})); }
      catch { console.error('Independent state is unavailable.'); }
      console.error('No automatic fallback cancel/reset, reconnect or replay. Inspect OBS before recovery.');
    }
    process.exitCode = 1;
  } finally {
    if (host) await host.close();
    obs.close();
    if (directory) await rm(directory, {recursive: true, force: true});
  }
}
export {expected, native, requireThat, stable, staticState, listenerIdentity, connect, snapshot, waitForSettled};
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => { console.error('REFUSED: ' + error.message); process.exitCode = 1; });
