import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpsRequest } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startValidationHost } from './host.mjs';

async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'muma-n01-tls-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  execFileSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-days', '1',
    '-subj', '/CN=localhost'], { stdio: 'ignore' });
  const cert = await readFile(join(dir, 'cert.pem'));
  const host = await startValidationHost({ ...options, tls: { cert, key: await readFile(join(dir, 'key.pem')) } });
  t.after(() => host.close());
  function req(path, { client = 0, token = host.clients[client].token, method = 'GET', body,
    headers = {}, trust = true, hostname = '127.0.0.1' } = {}) {
    return new Promise((resolve, reject) => {
      const target = new URL(path, host.url);
      const request = httpsRequest(target, { method, ca: trust ? cert : undefined,
        // Connect loopback but verify against the explicit certificate hostname, never disable TLS verification.
        servername: hostname === '127.0.0.1' ? 'localhost' : hostname,
        headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers } }, res => {
        let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, value: JSON.parse(text) }));
      });
      request.setTimeout(15000, () => request.destroy(new Error('client timeout')));
      request.on('error', reject); request.end(body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body));
    });
  }
  return { host, req, async submit(scenario, requestId, client = 0) {
    const r = await req('/v1/tasks', { method: 'POST', body: { scenario, requestId }, client });
    assert.equal(r.status, 200); return r.value.task;
  } };
}
async function until(check, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await check(); if (value) return value; await delay(40); }
  throw new Error('Acceptance wait timed out');
}
async function poll(f, task, state, client = 0) {
  return until(async () => { const r = await f.req(`/v1/tasks/${task.id}`, { client });
    assert.equal(r.status, 200); return r.value.task.status === state && r.value; });
}

test('N01 TLS trust, authentication, strict body/routes, ownership and bounded admission', { timeout: 30000 }, async t => {
  const f = await fixture(t, { run: async () => ({ text: 'unit runner' }) });
  assert.equal(f.host.address.address, '127.0.0.1');
  await assert.rejects(f.req('/v1/tasks', { trust: false }), /self.signed|certificate/i);
  await assert.rejects(f.req('/v1/tasks', { hostname: 'wrong.invalid' }), /hostname|altnames|certificate/i);
  assert.equal((await f.req('/v1/tasks', { token: 'wrong' })).status, 401);
  assert.equal((await f.req('/v1/tasks', { token: '' })).status, 401);
  assert.equal((await f.req('/v1/tasks', { headers: { origin: 'https://bad.invalid' } })).status, 403);
  assert.equal((await f.req('/v1/tasks?x=1')).status, 404);
  for (const body of ['bad json', { scenario: 'write' }, { scenario: 'bash', requestId: 'bad' },
    { scenario: 'write', requestId: '../bad' }, { scenario: 'write', requestId: 'x', path: '/tmp' },
    { scenario: ['write'], requestId: 'x' }, { scenario: 'write', requestId: 1 }, null, []]) {
    assert.equal((await f.req('/v1/tasks', { method: 'POST', body })).status, 400);
  }
  assert.equal((await f.req('/v1/tasks', { method: 'POST', body: 'x'.repeat(4097) })).status, 413);
  assert.equal((await f.req('/v1/tasks', { method: 'POST', body: {}, headers: { 'content-type': 'text/plain' } })).status, 415);
  const task = await f.submit('write', 'once');
  const duplicate = await f.req('/v1/tasks', { method: 'POST', body: { scenario: 'write', requestId: 'once' } });
  assert.equal(duplicate.value.task.id, task.id); assert.equal(duplicate.value.replayed, true);
  assert.equal((await f.req('/v1/tasks', { method: 'POST', body: { scenario: 'hold', requestId: 'once' } })).status, 409);
  for (const [path, method, body] of [[`/v1/tasks/${task.id}`, 'GET'], [`/v1/tasks/${task.id}/cancel`, 'POST', {}]]) {
    assert.equal((await f.req(path, { client: 1, method, body })).status, 404);
  }
  const done = await poll(f, task, 'succeeded');
  assert.equal(done.version, 1); assert.equal(done.terminal, true);
  assert.equal(done.events[0].type, 'task_state');
  assert.equal((await f.req(`/v1/tasks/${task.id}?after=${done.cursor}`)).value.events.length, 0);
  assert.equal((await f.req(`/v1/tasks/${task.id}?after=-1`)).status, 404);
  assert.equal(duplicate.headers['access-control-allow-origin'], undefined);
  for (let i = 1; i < 32; i++) await f.submit('write', `budget-${i}`);
  assert.equal((await f.req('/v1/tasks', { method: 'POST', body: { scenario: 'write', requestId: 'overflow' } })).status, 429);
});

test('N01 real PI SDK tool/stream, isolated projects, idempotent reconnect, cancel and cleanup', { timeout: 90000 }, async t => {
  const f = await fixture(t);
  const held = await f.submit('hold', 'hold-1');
  const pid = await until(async () => {
    try { return Number(await readFile(join(f.host.clients[0].path, 'fixture-hold.pid'), 'utf8')); } catch { return false; }
  });
  assert.ok(pid > 0);
  const queued = await f.submit('write', 'queued-1');
  assert.equal((await f.req(`/v1/tasks/${queued.id}`)).value.task.status, 'queued');
  const queuedCancel = await f.submit('write', 'queued-cancel');
  assert.equal((await f.req(`/v1/tasks/${queuedCancel.id}/cancel`, { method: 'POST', body: {} })).status, 200);
  const cancelledQueue = await poll(f, queuedCancel, 'cancelled');
  assert.equal(cancelledQueue.events.some(e => e.type === 'tool_start'), false);
  const other = await f.submit('write', 'other-project', 1);
  const done = await poll(f, other, 'succeeded', 1);
  assert.ok(done.events.some(e => e.type === 'text_delta'));
  assert.deepEqual(done.events.filter(e => e.type === 'tool_start').map(e => e.payload.toolName), ['write', 'bash']);
  assert.equal(await readFile(join(f.host.clients[1].path, 'result.txt'), 'utf8'), 'N01_OK\n');
  const beforeCancel = await f.req(`/v1/tasks/${held.id}`);
  // Reconnect is a new authenticated poll, not resubmission. Cursor pages exclude previously observed events.
  const stop = await f.req(`/v1/tasks/${held.id}/cancel`, { method: 'POST', body: {} });
  assert.equal(stop.status, 200); await poll(f, held, 'cancelled');
  await until(() => { try { process.kill(pid, 0); return false; } catch (e) { return e.code === 'ESRCH'; } });
  const resumed = await f.req(`/v1/tasks/${held.id}?after=${beforeCancel.value.cursor}`);
  assert.ok(resumed.value.events.every(e => e.id > beforeCancel.value.cursor));
  assert.ok(resumed.value.events.some(e => e.payload.status === 'cancelled'));
  await poll(f, queued, 'succeeded');
  assert.equal(await readFile(join(f.host.clients[0].path, 'result.txt'), 'utf8'), 'N01_OK\n');
  const dup = await f.req('/v1/tasks', { method: 'POST', body: { scenario: 'write', requestId: 'queued-1' } });
  assert.equal(dup.value.task.id, queued.id);
  const another = await f.submit('hold', 'shutdown-active');
  const shutdownPid = await until(async () => {
    try {
      const value = Number(await readFile(join(f.host.clients[0].path, 'fixture-hold.pid'), 'utf8'));
      return value !== pid && value;
    } catch { return false; }
  });
  assert.equal((await f.req(`/v1/tasks/${another.id}`)).value.task.status, 'running');
  const paths = f.host.clients.map(c => c.path);
  await f.host.close(); await f.host.close();
  await assert.rejects(f.req(`/v1/tasks/${another.id}`));
  assert.throws(() => process.kill(shutdownPid, 0), { code: 'ESRCH' });
  for (const path of paths) await assert.rejects(access(path), { code: 'ENOENT' });
  assert.equal((await stat(tmpdir())).isDirectory(), true);
});
