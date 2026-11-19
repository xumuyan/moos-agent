import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PassThrough, Writable } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { startDesktopHost } from './desktop-host.mjs';
import { serveDesktopPipe } from './desktop-host-stdio.mjs';
import { startDesktopModelFixture } from './desktop-model-fixture.mjs';

export function client(host) {
  let id = 0;
  return (method, params = {}) => host.call({ version: 1, id: `call-${++id}`, method, params });
}
export async function until(check, ms = 30000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { const value = await check(); if (value) return value; await delay(30); }
  throw new Error('Desktop acceptance timeout');
}
function setup(host) {
  const call = client(host);
  const projects = call('projects.list').result.projects;
  const scopes = projects.map(project => ({ projectId: project.id,
    sessionId: call('sessions.list', { projectId: project.id }).result.sessions[0].id }));
  return { call, scopes };
}
export function page(call, scope, taskId, cursor = null, limit = 100) {
  const response = call('tasks.events', { ...scope, taskId, cursor, limit });
  assert.equal(response.ok, true, JSON.stringify(response)); return response.result;
}
async function fixture(t, options) {
  const host = await startDesktopHost(options); t.after(() => host.close()); return host;
}

test('N01-D1 exact versioned allowlist, trusted registry, selection and resource ownership', async t => {
  const host = await fixture(t, { run: async () => ({ text: 'ok' }) });
  const { call, scopes: [a, b] } = setup(host);
  const names = call('projects.list').result.projects;
  assert.equal(names.length, 2); assert.equal(JSON.stringify(names).includes('path'), false);
  for (const p of host.trustedProjects) {
    assert.equal((await stat(p.path)).mode & 0o777, 0o700);
  }
  const s = call('sessions.create', { projectId: a.projectId, title: '第二会话' }).result.session;
  assert.ok(call('sessions.list', { projectId: a.projectId }).result.sessions.some(x => x.id === s.id));
  for (const input of [null, [], {}, { version: 2, id: 'x', method: 'projects.list', params: {} },
    { version: 1, id: 'x', method: 'projects.list', params: {}, path: '/tmp' }]) assert.equal(host.call(input).ok, false);
  for (const method of ['shell', 'files.read', 'http.request', 'projects.register', 'close']) assert.equal(call(method).error.code, 'unsupported_method');
  for (const extra of [{ path: '/tmp' }, { command: 'id' }, { provider: {} }, { apiKey: 'secret' }]) {
    assert.equal(call('tasks.submit', { ...a, text: 'hi', requestId: 'invalid', ...extra }).error.code, 'invalid_request');
  }
  for (const modelId of [null, {}, '', 'unknown', 'https://example.invalid']) {
    assert.equal(call('tasks.submit', { ...a, requestId: 'invalid-model', text: 'hi', modelId }).error.code, 'invalid_request');
  }
  for (const reasoningEffort of [null, {}, '', 'off', 'max', 'https://example.invalid']) {
    assert.equal(call('tasks.submit', { ...a, requestId: 'invalid-effort', text: 'hi', modelId: 'fixture-alternate', reasoningEffort }).error.code, 'invalid_request');
  }
  assert.equal(call('tasks.submit', { ...a, requestId: 'unsupported-effort', text: 'hi', reasoningEffort: 'low' }).error.code, 'invalid_request');
  for (const text of ['', ' ', null, 'a'.repeat(4097), '\0']) assert.equal(call('tasks.submit', { ...a, text, requestId: 'bad' }).ok, false);
  assert.equal(call('tasks.submit', { ...a, sessionId: b.sessionId, requestId: 'x', text: 'hi' }).error.code, 'not_found');
  const input = { ...a, requestId: 'once', text: 'arbitrary conversation prompt (not scenario enum)' };
  const task = call('tasks.submit', input).result.task;
  const duplicates = await Promise.all(Array.from({ length: 10 }, () => Promise.resolve(call('tasks.submit', input))));
  assert.ok(duplicates.every(r => r.result.replayed && r.result.task.id === task.id));
  assert.equal(call('tasks.submit', { ...input, text: 'changed' }).error.code, 'conflict');
  for (const method of ['tasks.cancel', 'tasks.events']) {
    const p = method === 'tasks.events' ? { cursor: null, limit: 100 } : {};
    assert.equal(call(method, { ...b, taskId: task.id, ...p }).error.code, 'not_found');
    assert.equal(call(method, { ...a, sessionId: s.id, taskId: task.id, ...p }).error.code, 'not_found');
  }
  await host.close();
  assert.equal(call('projects.list').error.code, 'closed');
  for (const p of host.trustedProjects) await assert.rejects(access(p.path), { code: 'ENOENT' });
});

test('N01-D1 selected model is bound at admission even while queued in the same project', async t => {
  const models = [];
  const host = await fixture(t, { run: async ({ task, provider }) => {
    models.push([task.message, provider.model, provider.thinkingLevel]);
    return { text: 'ok' };
  } });
  const { call, scopes: [scope] } = setup(host);
  const catalog = call('projects.list').result.models;
  assert.equal(catalog.defaultId, 'fixture');
  assert.deepEqual(catalog.options.map(m => [m.id, m.reasoning?.defaultId]), [['fixture', undefined], ['fixture-alternate', 'high']]);
  call('tasks.submit', { ...scope, requestId: 'first', text: 'first' });
  const queued = { ...scope, requestId: 'second', text: 'second', modelId: 'fixture-alternate', reasoningEffort: 'low' };
  const next = call('tasks.submit', queued).result.task;
  assert.equal(next.status, 'queued');
  assert.equal(call('tasks.submit', queued).result.task.id, next.id);
  assert.equal(call('tasks.submit', { ...queued, reasoningEffort: 'high' }).error.code, 'conflict');
  await until(() => page(call, scope, next.id).terminal);
  assert.deepEqual(models, [['first', 'fixture', 'off'], ['second', 'fixture-alternate', 'low']]);
});

test('N01-D1 terminal backlog 150+, bounded payload/pages, task-bound cursors and explicit retention gap', async t => {
  const host = await fixture(t, { run: async ({ emit, task }) => {
    const count = task.message === 'overflow' ? 4200 : 160;
    for (let i = 0; i < count; i++) emit('text_delta', { delta: String(i) });
    emit('tool_start', { toolCallId: 'tool1', toolName: 'write', args: { path: '/private/secret', content: 'secret' } });
    emit('tool_end', { toolCallId: 'tool1', toolName: 'write', result: { secret: 'hidden' } });
    return { text: 'done' };
  } });
  const { call, scopes: [a] } = setup(host);
  const task = call('tasks.submit', { ...a, requestId: 'paged', text: 'backlog' }).result.task;
  await until(() => page(call, a, task.id).terminal);
  let p = page(call, a, task.id); assert.equal(p.hasMore, true); assert.equal(p.events.length, 100);
  const events = [...p.events];
  while (p.hasMore) { const previous = p.cursor; p = page(call, a, task.id, previous); assert.notEqual(p.cursor, previous); events.push(...p.events); }
  assert.equal(events.filter(e => e.type === 'text_delta').length, 160);
  assert.equal(new Set(events.map(e => e.sequence)).size, events.length);
  assert.equal(events.at(-1).payload.status, 'succeeded');
  assert.equal(page(call, a, task.id, p.cursor).events.length, 0);
  assert.doesNotMatch(JSON.stringify(events), /secret|private|hidden|args|result/);
  for (const cursor of [-1, '', `${task.id}:9999999`, `${task.id}:01`, 'other:1']) {
    assert.equal(call('tasks.events', { ...a, taskId: task.id, cursor, limit: 100 }).error.code, 'invalid_cursor');
  }
  for (const limit of [0, 101, 1.1, '10']) assert.equal(call('tasks.events', { ...a, taskId: task.id, cursor: null, limit }).ok, false);
  const overflow = call('tasks.submit', { ...a, requestId: 'overflow', text: 'overflow' }).result.task;
  await until(() => call('tasks.events', { ...a, taskId: overflow.id, cursor: null, limit: 100 }).error?.code === 'cursor_expired');
  assert.equal(call('tasks.events', { ...a, taskId: overflow.id, cursor: p.cursor, limit: 100 }).error.code, 'invalid_cursor');
});

test('N01-D1 admission budget and terminal duplicate at limit', async t => {
  let runs = 0;
  const host = await fixture(t, { run: async () => { runs++; return { text: 'ok' }; } });
  const { call, scopes: [a] } = setup(host);
  for (let i = 0; i < 32; i++) assert.equal(call('tasks.submit', { ...a, requestId: `r${i}`, text: 'ok' }).ok, true);
  assert.equal(call('tasks.submit', { ...a, requestId: 'overflow', text: 'ok' }).error.code, 'limit');
  assert.equal(call('tasks.submit', { ...a, requestId: 'r0', text: 'ok' }).result.replayed, true);
  await host.close(); assert.ok(runs <= 1);
});

test('N01-D1 real PI SDK write/stream, two-project ownership, queue cancellation and active close', { timeout: 90000 }, async t => {
  const host = await fixture(t); const { call, scopes: [a, b] } = setup(host);
  const submit = (scope, requestId, text) => call('tasks.submit', { ...scope, requestId, text }).result.task;
  const held = submit(a, 'hold', 'MOOS_FIXTURE_HOLD');
  const pidPath = join(host.trustedProjects[0].path, 'fixture-hold.pid');
  const pid = await until(async () => { try { return Number(await readFile(pidPath, 'utf8')); } catch { return false; } });
  const queued = submit(a, 'queued', 'MOOS_FIXTURE_WRITE QUEUED');
  assert.equal(page(call, a, queued.id).task.status, 'queued');
  call('tasks.cancel', { ...a, taskId: queued.id });
  assert.equal(page(call, a, queued.id).task.status, 'cancelled');
  assert.equal(page(call, a, queued.id).events.some(e => e.type === 'tool_start'), false);
  const other = submit(b, 'write', 'MOOS_FIXTURE_WRITE DESKTOP_OK');
  const done = await until(() => { const p = page(call, b, other.id); return p.terminal && !p.hasMore && p; });
  assert.equal(done.task.status, 'succeeded');
  assert.equal(await readFile(join(host.trustedProjects[1].path, 'result.txt'), 'utf8'), 'DESKTOP_OK\n');
  assert.deepEqual(done.events.filter(e => e.type === 'tool_end').map(e => e.payload.toolName), ['write', 'read']);
  assert.match(done.events.filter(e => e.type === 'text_delta').map(e => e.payload.delta).join(''), /完成 DESKTOP_OK/);
  const ordinarySession = call('sessions.create', { projectId: b.projectId, title: '普通文本' }).result.session;
  const ordinaryScope = { projectId: b.projectId, sessionId: ordinarySession.id };
  const ordinary = submit(ordinaryScope, 'ordinary', '你好，请介绍当前本地验证');
  const ordinaryDone = await until(() => { const p = page(call, ordinaryScope, ordinary.id); return p.terminal && !p.hasMore && p; });
  assert.equal(ordinaryDone.task.status, 'succeeded');
  assert.match(ordinaryDone.events.filter(e => e.type === 'text_delta').map(e => e.payload.delta).join(''), /本地夹具响应：你好/);
  assert.equal(page(call, a, held.id).terminal, false);
  call('tasks.cancel', { ...a, taskId: held.id });
  await until(() => page(call, a, held.id).task.status === 'cancelled');
  await until(() => { try { process.kill(pid, 0); return false; } catch (e) { return e.code === 'ESRCH'; } });
  assert.equal(call('tasks.cancel', { ...a, taskId: held.id }).result.task.status, 'cancelled');
  const again = submit(a, 'shutdown', 'MOOS_FIXTURE_HOLD');
  const nextPid = await until(async () => { try { const p = Number(await readFile(pidPath, 'utf8')); return p !== pid && p; } catch { return false; } });
  assert.equal(page(call, a, again.id).terminal, false);
  await host.close(); assert.throws(() => process.kill(nextPid, 0), { code: 'ESRCH' });
});

test('N01-D1 actual child private pipe acceptance exits zero (including Unicode checkout path)', { timeout: 60000 }, async () => {
  const { stdout } = await promisify(execFile)(process.execPath,
    [fileURLToPath(new URL('./verify-desktop-host.mjs', import.meta.url))], { timeout: 55000 });
  const report = JSON.parse(stdout.trim()); assert.equal(report.status, 'passed');
  assert.equal(report.checks.length, 12);
  assert.ok(report.checks.includes('selected model reaches PI and loopback upstream'));
  assert.ok(report.checks.includes('allowlisted model effort reaches loopback and binds replay'));
  assert.ok(report.checks.includes('unknown model denial and replay conflict'));
  assert.equal(report.productionData, false);
});

test('N01-D1 private pipe framing, malformed input, bounded admission and EOF cleanup', async () => {
  for (const content of ['not-json\n', '{"id":"unterminated"}', 'x'.repeat(16385)]) {
    const input = new PassThrough(); const chunks = []; let closed = 0;
    const output = new Writable({ write(chunk, _, done) { chunks.push(chunk.toString()); done(); } });
    const running = serveDesktopPipe({ input, output, start: async () => ({
      call: () => ({ version: 1, id: null, ok: false, error: { code: 'invalid_request' } }),
      close: async () => { closed++; },
    }) });
    input.end(content); const result = await running;
    assert.equal(closed, 1); assert.equal(result.failed, content !== 'not-json\n');
  }
});

test('N01-D1 fragmented UTF-8 frames, invalid UTF-8 and per-frame byte boundary', async () => {
  for (const [parts, expectedCalls, expectedFailed] of [
    [[Buffer.from('{"a":"你好"}\n').subarray(0, 8), Buffer.from('{"a":"你好"}\n').subarray(8)], 1, false],
    [[Buffer.from(' '.repeat(16380) + '{}\n{}\n')], 2, false],
    [[Buffer.from(' '.repeat(16385)), Buffer.from('\n')], 0, true],
    [[Buffer.from('{"a":"'), Buffer.from([0xff]), Buffer.from('"}\n')], 1, false],
  ]) {
    const input = new PassThrough(); let count = 0, closed = 0; const received = [];
    const output = new Writable({ write(_, __, done) { done(); } });
    const running = serveDesktopPipe({ input, output, start: async () => ({
      call: r => { count++; received.push(r); return { ok: true }; }, close: async () => { closed++; },
    }) });
    for (const part of parts) input.write(part);
    // Let replies flush before clean EOF; invalid UTF-8 must reach validator as null, not replacement text.
    await until(() => count === expectedCalls || input.destroyed);
    input.end(); const result = await running;
    assert.equal(count, expectedCalls); assert.equal(result.failed, expectedFailed); assert.equal(closed, 1);
    if (parts.some(p => p.includes(255))) assert.equal(received[0], null);
  }
});

test('N01-D1 pipe serial backpressure, stalled reader, EPIPE/close, input error and oversized output', async () => {
  for (const mode of ['serial', 'stalled', 'epipe', 'close', 'input-error', 'eof', 'oversized']) {
    const input = new PassThrough(); let calls = 0, closed = 0, finishWrite;
    const output = new Writable({ highWaterMark: 1, write(_, __, done) {
      finishWrite = done;
      if (mode === 'epipe') done(Object.assign(new Error('private raw diagnostics'), { code: 'EPIPE' }));
      else if (mode === 'oversized') done();
    } });
    const running = serveDesktopPipe({ input, output, writeTimeoutMs: 100, start: async () => ({
      call: () => { calls++; return { result: mode === 'oversized' ? 'x'.repeat(512 * 1024) : 'ok' }; },
      close: async () => { closed++; },
    }) });
    input.write('{}\n{}\n');
    await until(() => calls > 0);
    if (mode === 'serial') {
      assert.equal(calls, 1); finishWrite();
      await until(() => calls === 2); finishWrite(); input.end();
    } else if (mode === 'close') output.destroy();
    else if (mode === 'input-error') input.destroy(new Error('sensitive input failure'));
    else if (mode === 'eof') input.end();
    const result = await running;
    assert.equal(result.failed, mode !== 'serial', mode);
    assert.equal(closed, 1, mode);
    if (mode !== 'serial') assert.equal(calls, 1, mode);
    // Release the test writable only after proving Host cancellation didn't wait on it.
    if (['stalled', 'close', 'input-error', 'eof'].includes(mode)) finishWrite?.();
  }
});

test('N01-D1 pipe startup parent loss and cleanup failure do not admit requests', async () => {
  const input = new PassThrough(), output = new PassThrough(); let release, closed = 0;
  const ready = new Promise(resolve => { release = resolve; });
  const running = serveDesktopPipe({ input, output, start: () => ready });
  input.destroy(); await delay(5);
  release({ call() { assert.fail('admission after parent loss'); }, close: async () => { closed++; } });
  await running; assert.equal(closed, 1);
  const second = new PassThrough();
  const failed = serveDesktopPipe({ input: second, output: new PassThrough(), start: async () => ({
    call: () => ({}), close: async () => { throw new Error('cleanup failed'); },
  }) });
  second.end(); await assert.rejects(failed, /cleanup failed/);
});

test('N01-D1 real PI is drained on malformed frame, output loss and reader stall', { timeout: 90000 }, async () => {
  for (const mode of ['malformed', 'output-loss', 'stall', 'eof']) {
    const host = await startDesktopHost(); const { scopes: [scope] } = setup(host);
    const input = new PassThrough(); let block = false, finishWrite;
    const output = new Writable({ write(_, __, done) { if (block) finishWrite = done; else done(); } });
    const running = serveDesktopPipe({ input, output, start: async () => host, writeTimeoutMs: 200 });
    input.write(JSON.stringify({ version: 1, id: 'live', method: 'tasks.submit', params: {
      ...scope, requestId: 'live', text: 'MOOS_FIXTURE_HOLD',
    } }) + '\n');
    const pidPath = join(host.trustedProjects[0].path, 'fixture-hold.pid');
    const pid = await until(async () => { try { return Number(await readFile(pidPath, 'utf8')); } catch { return false; } });
    if (mode === 'malformed') input.write('x'.repeat(16385));
    else if (mode === 'output-loss') output.destroy();
    else if (mode === 'eof') input.end();
    else { block = true; input.write('{"version":1,"id":"blocked","method":"projects.list","params":{}}\n'); }
    const result = await running; assert.equal(result.failed, mode !== 'eof', mode);
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, mode);
    for (const p of host.trustedProjects) await assert.rejects(access(p.path), { code: 'ENOENT' });
    finishWrite?.(); await host.close();
  }
});

test('N01-D1 sessions, byte limits and public payload whitelist remain bounded', async t => {
  const host = await fixture(t, { run: async ({ emit }) => {
    emit('text_delta', { delta: '中'.repeat(20000), credential: 'NOT_PUBLIC' });
    emit('tool_start', { toolName: 'injected', toolCallId: 'i'.repeat(1000), args: 'NOT_PUBLIC' });
    emit('private_debug', { secret: 'NOT_PUBLIC' });
    return { text: 'done' };
  } });
  const { call, scopes: [scope] } = setup(host);
  for (let i = 1; i < 16; i++) assert.equal(call('sessions.create', { projectId: scope.projectId, title: `s${i}` }).ok, true);
  assert.equal(call('sessions.create', { projectId: scope.projectId, title: 'over' }).error.code, 'limit');
  assert.equal(call('tasks.submit', { ...scope, requestId: 'large', text: '中'.repeat(1366) }).error.code, 'invalid_request');
  const task = call('tasks.submit', { ...scope, requestId: 'bounded', text: 'ok' }).result.task;
  await until(() => page(call, scope, task.id).terminal);
  const p = page(call, scope, task.id);
  assert.equal(p.hasMore, false);
  assert.equal(p.events.find(e => e.type === 'text_delta').payload.truncated, true);
  assert.equal(p.events.find(e => e.type === 'text_delta').payload.delta.length, 4096);
  const tool = p.events.find(e => e.type === 'tool_start').payload;
  assert.equal(tool.toolName, 'other'); assert.equal(tool.toolCallId.length, 200);
  assert.doesNotMatch(JSON.stringify(p), /NOT_PUBLIC|private_debug|credential/);
});

test('N01-D1 fixture binds loopback only, authenticates model calls and closes its listener', async () => {
  const model = await startDesktopModelFixture();
  const url = new URL(model.baseUrl); assert.equal(url.hostname, '127.0.0.1');
  assert.equal((await fetch(`${model.baseUrl}/chat/completions`, { method: 'POST', body: '{}' })).status, 403);
  assert.equal((await fetch(`${model.baseUrl}/chat/completions`, { method: 'POST',
    headers: { authorization: `Bearer ${model.apiKey}` }, body: '{}' })).status, 400);
  await model.close(); await model.close();
  await assert.rejects(fetch(`${model.baseUrl}/chat/completions`));
});

test('N01-D1 private runner failures expose only generic task code and public state', async t => {
  const host = await fixture(t, { run: async () => { throw new Error('credential=NOT_PUBLIC /private/NOT_PUBLIC upstream=NOT_PUBLIC'); } });
  const { call, scopes: [scope] } = setup(host);
  const task = call('tasks.submit', { ...scope, requestId: 'failure', text: 'fail safely' }).result.task;
  const done = await until(() => { const p = page(call, scope, task.id); return p.terminal && !p.hasMore && p; });
  assert.equal(done.task.status, 'failed'); assert.equal(done.task.errorCode, 'internal');
  assert.doesNotMatch(JSON.stringify(done), /NOT_PUBLIC|credential|private|upstream|stack/);
});
