import test from 'node:test';
import assert from 'node:assert/strict';
import { cpuSeconds, parseProcesses, applicationProcesses, intervalUsage, parseFootprint } from './measure-electron-processes.mjs';
test('CPU time parses minutes, hours and days without using recent ps CPU averages', () => {
  assert.equal(cpuSeconds('02:03.50'), 123.5);
  assert.equal(cpuSeconds('01:02:03.50'), 3723.5);
  assert.equal(cpuSeconds('1-02:03:04'), 93784);
  assert.throws(() => cpuSeconds('garbage'));
});
test('process inventory preserves Unicode paths and excludes unrelated and external tool processes', () => {
  const rows = parseProcesses(' 10 1 1024 00:01.00 /Applications/沐码.app/Contents/MacOS/MuMa\n11 10 2048 00:02.00 /Applications/沐码.app/Contents/Frameworks/Helper (Renderer)\n12 10 9000 00:30.00 /usr/bin/clang\n13 1 1024 00:01.00 /Applications/Other.app/Contents/MacOS/Other');
  assert.deepEqual(applicationProcesses(rows, 10).map(row => row.pid), [10, 11]);
  assert.throws(() => applicationProcesses(rows, 100), /missing/);
});
test('CPU deltas measure one-core percentages and explicitly report process churn', () => {
  const before = [{pid: 1, cpuSeconds: 10, rssKiB: 1024}, {pid: 3, cpuSeconds: 100, rssKiB: 1024}];
  const after = [{pid: 1, cpuSeconds: 11, rssKiB: 2048}, {pid: 2, cpuSeconds: 0.5, rssKiB: 1024}];
  const r = intervalUsage(before, after, 2);
  assert.equal(r.cpuPercent, 75); assert.equal(r.rssMiB, 3);
  assert.equal(r.newProcesses, 1); assert.equal(r.exitedProcesses, 1);
  assert.throws(() => intervalUsage(before, after, 0));
});

test('macOS byte units and complete process coverage are required for footprint reporting', () => {
  const report = { unit: 'byte', 'bytes per unit': 1, 'total footprint': 2097152,
    processes: [{pid: 2, footprint: 2097152}], errors: [] };
  assert.equal(parseFootprint(report, [2]).totalMiB, 2);
  assert.throws(() => parseFootprint(report, [3]), /Incomplete/);
  assert.throws(() => parseFootprint({...report, errors: ['permission denied']}, [2]), /Incomplete/);
  assert.throws(() => parseFootprint({...report, processes: [{pid: 2}]}, [2]), /Incomplete/);
  assert.throws(() => parseFootprint({...report, 'total footprint': -1}, [2]), /Incomplete/);
});
