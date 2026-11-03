import test from 'node:test';
import assert from 'node:assert/strict';
import { localOrigin, verifyHealth } from './mobile/moos-m01-mobile/probe-contract.js';
import { healthServer } from './health-server.mjs';

test('mobile probe accepts only local origins and matches challenge and protocol', () => {
  for (const origin of ['http://mac.local:43101', 'http://192.168.1.20:43101', 'https://10.0.0.2']) {
    assert.equal(localOrigin(origin), origin);
  }
  for (const origin of ['http://example.com', 'http://localhost', 'http://127.0.0.1',
    'http://user:password@mac.local', 'http://mac.local:99999', 'http://mac.local/path', 'http://010.1.1.1', 'http://10.0x10.0.1', 'file:///etc/passwd']) {
    assert.throws(() => localOrigin(origin));
  }
  const body = { service: 'moos-m01-health', protocolVersion: 1, probeId: 'current' };
  assert.match(verifyHealth(200, body, 'current'), /Mac/);
  assert.throws(() => verifyHealth(200, body, 'stale'));
  assert.throws(() => verifyHealth(500, body, 'current'));
  assert.throws(() => verifyHealth(200, { ...body, service: 'other' }, 'current'));
});

test('LAN probe server echoes valid challenges and exposes no task API', async () => {
  const server = healthServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(origin + '/health?probeId=m01-current');
    const body = await response.json();
    assert.match(verifyHealth(response.status, body, 'm01-current'), /Mac/);
    assert.equal((await fetch(origin + '/health')).status, 400);
    assert.equal((await fetch(origin + '/tasks', { method: 'POST' })).status, 404);
    assert.equal((await fetch(origin + '/health?probeId=invalid%20id')).status, 400);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('mobile page JavaScript parses before invoking the native compiler', async () => {
  const { readFile } = await import('node:fs/promises');
  const { spawnSync } = await import('node:child_process');
  const source = await readFile('probes/m01/mobile/moos-m01-mobile/pages/index/index.uvue', 'utf8');
  const script = source.match(/<script setup>([\s\S]*?)<\/script>/)[1];
  const result = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: script, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
