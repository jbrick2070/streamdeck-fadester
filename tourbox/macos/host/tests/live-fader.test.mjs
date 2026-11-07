// SPDX-License-Identifier: GPL-2.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {waitForSettled} from './live-fader.mjs';

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
