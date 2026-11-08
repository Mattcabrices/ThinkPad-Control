import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FanLevelSpeeds, SETTLE_MS } from '../src/fan-levels.js';

const fan = (mode, level, rpm) => [{ controlUnit: 'level', mode, level, rpm }];
function run(steps, file = null) {
  let time = 0; const speeds = new FanLevelSpeeds(file, () => time);
  for (const [mode, level, rpm, wait] of steps) { speeds.observe(fan(mode, level, rpm)); time += wait ?? SETTLE_MS; }
  return speeds;
}
test('a level is recorded only once it has settled', () => {
  assert.deepEqual(run([['manual', 4, 3300, 1000], ['manual', 4, 3800, 0]]).view().speeds, {});
  assert.deepEqual(run([['manual', 4, 3300], ['manual', 4, 3800]]).view().speeds, { 4: 3800 });
});
test('a zero or missing reading is never recorded as a speed', () => {
  assert.deepEqual(run([['manual', 2, 3000], ['manual', 2, 0], ['manual', 2, null]]).view().speeds, {});
  const kept = run([['manual', 2, 3000], ['manual', 2, 3000], ['manual', 2, 0]]);
  assert.equal(kept.view().speeds[2], 3000, 'A later zero does not erase a real reading');
});
test('curve levels count, and changing level restarts the wait', () => {
  assert.deepEqual(run([['curve', 3, 3200], ['curve', 3, 3200]]).view().speeds, { 3: 3200 });
  assert.deepEqual(run([['manual', 7, 3800], ['manual', 2, 3700]]).view().speeds, {}, 'A fan still slowing is not level 2 yet');
});
test('full speed keeps its highest settled reading, and normal levels their latest', () => {
  assert.equal(run([['manual', 64, 4900], ['manual', 64, 5056], ['manual', 64, 4900]]).view().speeds[64], 5056);
  assert.equal(run([['manual', 5, 3800], ['manual', 5, 3800], ['manual', 5, 3700]]).view().speeds[5], 3700);
});
test('firmware speed is kept separately as a peak, never as a level', () => {
  const view = run([['auto', null, 2500], ['auto', null, 5316], ['auto', null, 3000]]).view();
  assert.equal(view.firmwarePeak, 5316); assert.deepEqual(view.speeds, {});
});
test('readings survive a restart', t => {
  const dir = mkdtempSync(join(tmpdir(), 'thinkpad-levels-')), file = join(dir, 'nested', 'levels.json'); t.after(() => rmSync(dir, { recursive: true, force: true }));
  run([['manual', 7, 3800], ['manual', 7, 3800]], file);
  assert.equal(new FanLevelSpeeds(file).view().speeds[7], 3800);
});
test('other fan types are left alone', () => {
  const speeds = new FanLevelSpeeds(); speeds.observe([{ controlUnit: 'percent', mode: 'manual', percent: 50, rpm: 2000 }]);
  assert.deepEqual(speeds.view().speeds, {});
});
