// SPDX-License-Identifier: GPL-2.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough, Writable} from 'node:stream';
import {readNativeOnce, waitForSettled} from './live-fader.mjs';

function clock(timeout = 2500) {
  let time = 0;
  return {now: () => time, pause: async ms => { time += ms; }, timeout};
}
test('native51 may precede the renderer; read-only polling waits for two settled samples', async () => {
  const values = [.01328124944, .032, .0498046875, .0498046875]; let reads = 0;
  const result = await waitForSettled(async () => ({nativeTick: 51, cursor: values[reads++]}), clock());
  assert.equal(reads, 4); assert.equal(result.cursor, .0498046875);
});
test('native change or unexpected full renderer state aborts immediately', async () => {
  for (const value of [{nativeTick: 50, cursor: .0498}, {nativeTick: 51, cursor: 1}]) {
    let reads = 0;
    await assert.rejects(waitForSettled(async () => { reads++; return value; }, clock()));
    assert.equal(reads, 1);
  }
});
test('a fixture/output guard failure propagates without another sample or retry', async () => {
  let reads = 0;
  await assert.rejects(waitForSettled(async () => {
    if (++reads === 2) throw new Error('Output became active');
    return {nativeTick: 51, cursor: .01328};
  }, clock()), /Output became active/);
  assert.equal(reads, 2);
});
test('a renderer that stays below target reaches a bounded deadline', async () => {
  let reads = 0;
  await assert.rejects(waitForSettled(async () => { reads++; return {nativeTick: 51, cursor: .01}; }, clock(200)), /did not settle/);
  assert.equal(reads, 4);
});

/** A stand-in for the native helper process: stdout to answer on, a stdin that takes anything, a kill that does nothing. */
function fakeHelper() {
  const helper = new EventEmitter();
  helper.stdout = new PassThrough();
  helper.stdin = new Writable({write(_chunk, _encoding, done) { done(); }});
  helper.kill = () => true;
  return helper;
}
test('a native helper that ends before answering READ is reported at once, not waited for', async () => {
  const helper = fakeHelper();
  const started = Date.now();
  const reading = readNativeOnce(helper);
  helper.stdout.end();
  helper.emit('close', 1, null);
  await assert.rejects(reading, /exited before READ/);
  assert.ok(Date.now() - started < 1000, 'rejected well under a second');
});
test('a READ answered with OK resolves its tick, and the helper is let go once it closes', async () => {
  const helper = fakeHelper();
  const reading = readNativeOnce(helper);
  helper.stdout.write('OK 51\n');
  setTimeout(() => helper.emit('close', 0, null), 10);
  assert.equal(await reading, 51);
});
