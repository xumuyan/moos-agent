import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);

test('N01-D1 actual macOS Swift private-pipe lifecycle and malformed/blocked child guards', {
  skip: process.platform !== 'darwin' ? 'macOS native compiler required' : false,
  timeout: 90000,
}, async () => {
  const { stdout } = await exec(process.execPath, [fileURLToPath(new URL('./verify-desktop-native.mjs', import.meta.url)), '--native-only'], {
    timeout: 80000, maxBuffer: 1024 * 1024,
  });
  const report = JSON.parse(stdout.trim().split('\n').at(-1));
  assert.equal(report.passed, true);
  assert.ok(report.nativeChecks >= 63);
  assert.equal(report.platform, 'macOS Foundation private pipes');
});
