import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { encodeBootstrap } from './bootstrap.mjs';
const exec = promisify(execFile);

test('bootstrap encoding rejects malformed or non-loopback material without echoing input', () => {
  const invalid = [null, {}, { version: 2 }, { secret: 'sensitive-placeholder' }];
  for (const value of invalid) {
    assert.throws(() => encodeBootstrap(value, Buffer.alloc(0)), error =>
      error.message === 'Invalid bootstrap material' && !error.message.includes('sensitive-placeholder'));
  }
});

test('native candidate parses, bounds lifetime and verifies cross-language transcript without promotion', { timeout: 120000 }, async () => {
  const { stdout } = await exec(process.execPath, ['probes/nsh-validation/verify-bootstrap.mjs'], {
    timeout: 110000, maxBuffer: 1024 * 1024
  });
  const result = JSON.parse(stdout);
  assert.equal(result.status, 'passed'); assert.ok(result.checks >= 42);
  assert.equal(result.httpRequests, 2);
  for (const field of ['phoneVerified', 'humanConfirmationVerified', 'trustPromoted', 'nshBridgeVerified',
    'claimSentOverHTTPS', 'systemTrustChanged', 'credentialsIssued']) assert.equal(result[field], false);
});
