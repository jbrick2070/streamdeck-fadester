// SPDX-License-Identifier: GPL-2.0-or-later
// Separately reviewed, explicit one-shot recovery of the pinned rental fixture.
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {expected, native, requireThat, stable, staticState, listenerIdentity, connect, snapshot} from './live-fader.mjs';

function nativeReader() {
  const env = {...process.env}; delete env.FADESTER_OBS_PASSWORD; delete env.FADESTER_MAC_OBS_PASSWORD;
  const child = spawn(join(native, 'Contents/MacOS/FadesterNativeSlider'), ['--stdio', '--obs-pid', String(expected.pid), '--obs-port', String(expected.port)], {stdio: ['pipe', 'pipe', 'pipe'], env});
  let pending, ended = false, finishedResolve;
  const finished = new Promise(resolve => { finishedResolve = resolve; });
  const reject = message => { if (pending) { clearTimeout(pending.timer); pending.reject(new Error(message)); pending = null; } };
  createInterface({input: child.stdout}).on('line', line => {
    if (!pending) return;
    const current = pending; pending = null; clearTimeout(current.timer);
    /^OK [0-9]{1,4}$/.test(line) ? current.resolve(Number(line.slice(3))) : current.reject(new Error('Native helper refused or could not confirm the command.'));
  });
  child.stdin.on('error', () => reject('Native stdin closed; command unconfirmed.'));
  child.on('error', () => { ended = true; reject('Native helper launch failed.'); finishedResolve({code: -1, signal: null}); });
  child.on('close', (code, signal) => { ended = true; reject('Native helper exited; command unconfirmed.'); finishedResolve({code, signal}); });
  return {
    request(line) {
      requireThat(!pending && !ended, 'Native helper is unavailable.');
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending = null; reject(new Error('Native command timed out; it will not be replayed.')); }, 5000);
        pending = {resolve, reject, timer}; child.stdin.write(line + '\n');
      });
    },
    async close() {
      if (!ended && !child.stdin.destroyed) child.stdin.end();
      const stop = setTimeout(() => { if (!ended) child.kill('SIGTERM'); }, 1500);
      const kill = setTimeout(() => { if (!ended) child.kill('SIGKILL'); }, 3000);
      try { return await finished; } finally { clearTimeout(stop); clearTimeout(kill); }
    }
  };
}
async function main() {
  requireThat(process.platform === 'darwin' && process.argv.length === 5 && process.argv[2] === '--recover' && process.argv[4] === '--expect-51',
    'Use --recover REVIEWED_RECEIPT --expect-51 on the Mac. No action started.');
  const receipt = JSON.parse(await readFile(process.argv[3], 'utf8'));
  requireThat(stable(receipt.expected) === stable(expected) && Date.now() - Date.parse(receipt.createdAt) >= 0 && Date.now() - Date.parse(receipt.createdAt) < 30 * 60 * 1000,
    'Reviewed fixture receipt is invalid or expired.');
  const config = JSON.parse(await readFile(join(homedir(), 'Library/Application Support/obs-studio/plugin_config/obs-websocket/config.json'), 'utf8'));
  requireThat(config.server_enabled === true && config.auth_required === true && config.server_port === expected.port && typeof config.server_password === 'string' && config.server_password,
    'Expected authenticated local OBS configuration.');
  listenerIdentity();
  const obs = await connect(config.server_password, true);
  let helper, moved = false, released = false;
  const inspect = async () => {
    const state = await snapshot(obs); listenerIdentity();
    requireThat(staticState(state) === staticState(receipt.snapshot), 'Fixture, transition, settings, transforms or output state changed.');
    requireThat(state.scenes.currentPreviewSceneUuid === expected.preview && [expected.program, expected.preview].includes(state.scenes.currentProgramSceneUuid), 'Scene ownership changed.');
    requireThat(state.studio.studioModeEnabled === true && state.stream.outputActive === false && state.record.outputActive === false &&
      state.virtualCamera.outputActive === false && state.replay.outputActive === false, 'Output activity or Studio Mode changed.');
    return state;
  };
  try {
    await inspect(); helper = nativeReader();
    requireThat(await helper.request('READ') === 51, 'Native bar is not exactly the reviewed tick51.');
    const before = await inspect();
    requireThat(before.cursor.transitionCursor >= .03 && before.cursor.transitionCursor <= .07, 'Renderer is not the reviewed settled partial blend.');
    requireThat(await helper.request('MOVE 51 0 ' + Date.now()) === 0, 'Native zero write was not confirmed; no frontend release permitted.');
    moved = true;
    await inspect();
    requireThat(await helper.request('READ') === 0, 'Native zero ownership changed before release.');
    await obs.releaseZeroOnce(); released = true;
    const deadline = performance.now() + 2500;
    let after;
    do {
      after = await inspect();
      if (after.scenes.currentProgramSceneUuid === expected.program && [0, 1].includes(after.cursor.transitionCursor)) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (performance.now() < deadline);
    requireThat(after.scenes.currentProgramSceneUuid === expected.program && after.scenes.currentPreviewSceneUuid === expected.preview && [0, 1].includes(after.cursor.transitionCursor), 'Frontend release did not restore baseline scenes and idle cursor.');
    requireThat(await helper.request('READ') === 0, 'Final native readback is not zero.');
    const exit = await helper.close(); helper = null;
    requireThat(exit.code === 0 && exit.signal === null, 'Native helper did not exit cleanly.');
    const final = await inspect();
    requireThat(final.scenes.currentProgramSceneUuid === expected.program && [0, 1].includes(final.cursor.transitionCursor), 'State changed during helper shutdown.');
    console.log(JSON.stringify({recovery: 'PASS', native: '51→0', nativeMoveCount: 1, releaseCount: 1,
      cursor: final.cursor.transitionCursor, program: final.scenes.currentProgramSceneUuid, preview: final.scenes.currentPreviewSceneUuid,
      fixtureUnchanged: true, outputsInactive: true}));
  } catch (error) {
    console.error('RECOVERY STOPPED: ' + String(error.message).replaceAll(config.server_password, '[redacted]'));
    console.error(JSON.stringify({movedConfirmed: moved, releaseConfirmed: released, noRetryOrFallback: true}));
    try { const state = await snapshot(obs); console.error(JSON.stringify({inspectionOnly: true, cursor: state.cursor.transitionCursor,
      program: state.scenes.currentProgramSceneUuid, preview: state.scenes.currentPreviewSceneUuid})); } catch {}
    process.exitCode = 1;
  } finally {
    if (helper) await helper.close(); obs.close();
  }
}
main().catch(error => { console.error('REFUSED: ' + error.message); process.exitCode = 1; });
