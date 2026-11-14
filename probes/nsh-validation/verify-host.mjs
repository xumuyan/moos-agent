/** Standalone real-PI acceptance; disposable local TLS material, no phone deployment. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { request } from 'node:https';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startValidationHost } from './host.mjs';

const dir = await mkdtemp(join(tmpdir(), 'n01-acceptance-'));
let host;
try {
  execFileSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-days', '1',
    '-subj', '/CN=localhost'], { stdio: 'ignore' });
  const cert = await readFile(join(dir, 'cert.pem'));
  host = await startValidationHost({ tls: { cert, key: await readFile(join(dir, 'key.pem')) } });
  const api = (path, body) => new Promise((resolve, reject) => {
    const req = request(new URL(path, host.url), { ca: cert, servername: 'localhost',
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${host.clients[0].token}`, 'content-type': 'application/json' } }, res => {
      let value = ''; res.on('data', c => { value += c; });
      res.on('end', () => {
        try { assert.equal(res.statusCode, 200); resolve(JSON.parse(value)); } catch (error) { reject(error); }
      });
    });
    req.setTimeout(10000, () => req.destroy(new Error('acceptance request timeout')));
    req.on('error', reject); req.end(body && JSON.stringify(body));
  });
  const created = await api('/v1/tasks', { scenario: 'write', requestId: 'acceptance-once' });
  let snapshot;
  const deadline = Date.now() + 30000;
  do {
    snapshot = await api(`/v1/tasks/${created.task.id}`);
    if (snapshot.terminal) break;
    await delay(50);
  } while (Date.now() < deadline);
  assert.equal(snapshot.task.status, 'succeeded');
  assert.equal(await readFile(join(host.clients[0].path, 'result.txt'), 'utf8'), 'N01_OK\n');
  const tools = snapshot.events.filter(e => e.type === 'tool_end');
  assert.deepEqual(tools.map(e => e.payload.toolName), ['write', 'bash']);
  assert.ok(tools.every(e => !e.payload.isError));
  const output = snapshot.events.filter(e => e.type === 'text_delta').map(e => e.payload.delta).join('');
  assert.match(output, /完成 N01_OK/);
  const duplicate = await api('/v1/tasks', { scenario: 'write', requestId: 'acceptance-once' });
  assert.equal(duplicate.task.id, created.task.id); assert.equal(duplicate.replayed, true);
  assert.equal((await api(`/v1/tasks/${created.task.id}?after=${snapshot.cursor}`)).events.length, 0);
  console.log(JSON.stringify({ status: 'passed', scope: 'Mac loopback TLS, real PI SDK, local mock model',
    checks: ['TLS certificate validation', 'authenticated submission', 'write tool', 'bash tool',
      'streamed text events', 'terminal success', 'idempotent resubmission', 'cursor reconnect'],
    phoneConnected: false, externalModelUsed: false, productionDataUsed: false }));
} finally { await host?.close(); await rm(dir, { recursive: true, force: true }); }
