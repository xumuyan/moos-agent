import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
test('native fixed pairing POSTs bind transcript, gate redeem and close failed or cancelled candidates', { timeout: 150000 }, async () => {
  const { stdout } = await exec(process.execPath, ['probes/nsh-validation/verify-pairing-network.mjs'], {
    timeout: 140000, maxBuffer: 1024 * 1024
  });
  const result = JSON.parse(stdout);
  assert.equal(result.status, 'passed'); assert.equal(result.claimSentOverHTTPS, true);
  assert.ok(result.checks >= 40); assert.equal(result.closedBeforeResponse, 1);
  for (const key of ['phoneVerified', 'humanConfirmationVerified', 'systemTrustChanged',
    'credentialsPersisted', 'nshBridgeVerified', 'taskServerConnected']) assert.equal(result[key], false);
});
