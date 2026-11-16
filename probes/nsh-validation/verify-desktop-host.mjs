/** N01-D1 independent native-parent stand-in: actual child private pipe + real PI. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const child = spawn(process.execPath, [fileURLToPath(new URL('./desktop-host-stdio.mjs', import.meta.url))], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { PATH: process.env.PATH, TMPDIR: '/private/tmp/', LANG: 'en_US.UTF-8' },
});
const exit = once(child, 'exit');
child.on('exit', () => {
  for (const pending of waiting.values()) { clearTimeout(pending.timer); pending.reject(new Error('Host exited before reply')); }
  waiting.clear();
});
const lines = createInterface({ input: child.stdout });
const waiting = new Map(); let sequence = 0, stderrBytes = 0;
child.stderr.on('data', part => { stderrBytes += part.length; }); // no raw diagnostic/credential export
lines.on('line', line => {
  const r = JSON.parse(line), pending = waiting.get(r.id);
  if (pending) { waiting.delete(r.id); clearTimeout(pending.timer); pending.resolve(r); }
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = `accept-${++sequence}`;
  const timer = setTimeout(() => { waiting.delete(id); reject(new Error('Private pipe response timeout')); }, 30000);
  waiting.set(id, { resolve, reject, timer });
  child.stdin.write(JSON.stringify({ version: 1, id, method, params }) + '\n');
});
async function ok(method, params) { const r = await call(method, params); assert.equal(r.ok, true); return r.result; }
async function poll(scope, id) {
  const events = []; let cursor = null;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const p = await ok('tasks.events', { ...scope, taskId: id, cursor, limit: 50 });
    events.push(...p.events); cursor = p.cursor;
    if (p.terminal && !p.hasMore) return { ...p, events };
    if (!p.hasMore) await delay(25);
  }
  throw new Error('Task timeout');
}
async function started(scope, taskId) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const p = await ok('tasks.events', { ...scope, taskId, cursor: null, limit: 100 });
    if (p.events.some(e => e.type === 'tool_start' && e.payload.toolName === 'bash')) return;
    assert.equal(p.terminal, false, 'Hold task terminated before registered tool started');
    await delay(25);
  }
  throw new Error('Registered tool start timeout');
}
let passed = false;
try {
  const projects = (await ok('projects.list')).projects;
  assert.equal(projects.length, 2); assert.equal(JSON.stringify(projects).includes('path'), false);
  const projectId = projects[0].id;
  const sessionId = (await ok('sessions.create', { projectId, title: '独立管道验收' })).session.id;
  const scope = { projectId, sessionId };
  const params = { ...scope, requestId: 'ordinary-once', text: '你好，真实 PI 本地夹具' };
  const created = await ok('tasks.submit', params);
  const done = await poll(scope, created.task.id);
  assert.equal(done.task.status, 'succeeded');
  assert.match(done.events.filter(e => e.type === 'text_delta').map(e => e.payload.delta).join(''), /本地夹具响应：你好/);
  const duplicate = await ok('tasks.submit', params); assert.equal(duplicate.task.id, created.task.id); assert.equal(duplicate.replayed, true);
  assert.equal((await call('tasks.submit', { ...params, path: '/tmp' })).error.code, 'invalid_request');
  const written = await ok('tasks.submit', { ...scope, requestId: 'write', text: 'MOOS_FIXTURE_WRITE PIPE_OK' });
  const tools = await poll(scope, written.task.id); assert.equal(tools.task.status, 'succeeded');
  assert.deepEqual(tools.events.filter(e => e.type === 'tool_end').map(e => e.payload.toolName), ['write', 'read']);
  assert.ok(tools.events.filter(e => e.type === 'tool_end').every(e => !e.payload.isError));
  const foreignSession = (await ok('sessions.list', { projectId: projects[1].id })).sessions[0].id;
  assert.equal((await call('tasks.cancel', { projectId: projects[1].id, sessionId: foreignSession, taskId: written.task.id })).error.code, 'not_found');
  const held = await ok('tasks.submit', { ...scope, requestId: 'hold', text: 'MOOS_FIXTURE_HOLD' });
  await started(scope, held.task.id);
  await ok('tasks.cancel', { ...scope, taskId: held.task.id });
  assert.equal((await poll(scope, held.task.id)).task.status, 'cancelled');
  // EOF must cancel/drain another live task and let the host exit normally.
  const eof = await ok('tasks.submit', { ...scope, requestId: 'eof-active', text: 'MOOS_FIXTURE_HOLD' });
  await started(scope, eof.task.id);
  child.stdin.end();
  let deadline;
  const [code, signal] = await Promise.race([exit, new Promise((_, reject) => {
    deadline = setTimeout(() => reject(new Error('Host EOF cleanup timeout')), 20000);
  })]).finally(() => clearTimeout(deadline));
  assert.equal(code, 0); assert.equal(signal, null);
  passed = true;
  console.log(JSON.stringify({ status: 'passed', scope: 'N01-D1 private pipe child + real PI SDK + loopback local fixture',
    checks: ['trusted project IDs', 'session create/select', 'ordinary prompt', 'write/read tool events', 'idempotent duplicate',
      'strict params', 'cross-project denial', 'active cancellation', 'active EOF normal exit'],
    stderrBytes, nativeGUI: false, externalModel: false, productionData: false, deployed: false }));
} finally {
  for (const pending of waiting.values()) clearTimeout(pending.timer);
  lines.close();
  if (!passed && child.exitCode === null && child.signalCode === null) {
    child.stdin.end(); child.kill('SIGTERM');
    let timer;
    await Promise.race([exit, new Promise(resolve => { timer = setTimeout(resolve, 20000); })]).finally(() => clearTimeout(timer));
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL'); // owned Host only; failure cleanup is not normal-exit acceptance
      await exit;
    }
  }
}
