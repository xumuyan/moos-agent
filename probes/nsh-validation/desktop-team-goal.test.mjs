import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../../services/agent/store.mjs';
import { startDesktopHost } from './desktop-host.mjs';

function wire(host) {
  let n = 0;
  const call = (method, params = {}) => host.call({ version: 1, id: `call-${++n}`, method, params });
  const ok = (method, params) => {
    const response = call(method, params);
    assert.equal(response.ok, true, JSON.stringify(response));
    return response.result;
  };
  assert.equal(ok('projects.list').teamGoals, true);
  const scopes = ok('projects.list').projects.map(({ id: projectId }) => ({
    projectId, sessionId: ok('sessions.list', { projectId }).sessions[0].id,
  }));
  return { call, ok, scopes };
}

async function isolated(t) {
  const profileDir = await realpath(await mkdtemp(join(tmpdir(), 'muma-team-goal-test-')));
  let host;
  t.after(async () => { await host?.close(); await rm(profileDir, { recursive: true, force: true }); });
  return {
    profileDir,
    get host() { return host; },
    async open() { if (host) await host.close(); host = await startDesktopHost({ profileDir }); return wire(host); },
  };
}

async function observe(ok, scope, taskId, until = page => page.terminal && !page.hasMore) {
  const deadline = Date.now() + 15000;
  let cursor = null;
  const events = [];
  do {
    const page = ok('tasks.events', { ...scope, taskId, cursor, limit: 100 });
    cursor = page.cursor;
    events.push(...page.events);
    if (until(page, events)) return { ...page, events };
    if (!page.hasMore) await delay(20);
  } while (Date.now() < deadline);
  throw Error('Team goal did not reach expected status');
}

test('team goal continues on verified gap, completes only after independent evidence and ignores cumulative token budget', { timeout: 30000 }, async t => {
  const box = await isolated(t);
  const { call, ok, scopes: [a, b] } = await box.open();
  const command = { ...a, text: 'N01_GOAL_REPAIR', requestId: 'repair', teamGoal: 'start' };
  const start = ok('tasks.submit', command);
  assert.equal(start.teamGoal.status, 'queued');
  assert.equal(ok('tasks.submit', command).task.id, start.task.id);
  assert.equal(call('tasks.submit', { ...command, requestId: 'other-goal' }).error.code, 'conflict');
  assert.equal(call('tasks.submit', { ...command, teamGoal: 'bogus' }).error.code, 'invalid_request');
  assert.equal(call('tasks.events', { ...b, taskId: start.task.id, cursor: null, limit: 10 }).error.code, 'not_found');
  const page = await observe(ok, a, start.task.id);
  assert.equal(page.teamGoal.id, start.teamGoal.id);
  assert.equal(page.teamGoal.round, 2);
  assert.equal(page.teamGoal.status, 'completed');
  assert.equal(page.teamGoal.verifiedMembers, 1);
  assert.match(page.events.filter(e => e.type === 'text_delta').map(e => e.payload.delta).join(''), /团队已独立验证/);
  assert.equal(await readFile(join(box.profileDir, 'workspace-0/team-goal-result.txt'), 'utf8'), 'goal-complete\n');
  await box.host.close();
  const stored = new Store({ dbPath: join(box.profileDir, 'data/desktop.sqlite') });
  try {
    assert.ok(stored.listEvents(start.task.id).some(e => e.type === 'usage' && e.payload.inputTokens > 2000000));
  } finally { stored.close(); }
});

test('team goal pause drains the owned tool, preserves another project, and resumes after reopening without replay', { timeout: 45000 }, async t => {
  const box = await isolated(t);
  const { ok, scopes: [a, b] } = await box.open();
  const params = { ...a, text: 'N01_GOAL_PAUSE', requestId: 'pause', teamGoal: 'start' };
  const first = ok('tasks.submit', params);
  await observe(ok, a, first.task.id, (_page, events) => events.some(e => e.type === 'tool_start' && e.payload.toolName === 'bash'));
  let child;
  const deadline = Date.now() + 5000;
  while (!child && Date.now() < deadline) {
    try { child = Number(await readFile(join(box.profileDir, 'workspace-0/fixture-goal-hold.pid'), 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; await delay(20); }
  }
  assert.ok(Number.isSafeInteger(child) && child > 1);
  const parallel = ok('tasks.submit', { ...b, text: 'N01_GOAL_OTHER', requestId: 'parallel', teamGoal: 'start' });
  ok('tasks.cancel', { ...a, taskId: first.task.id });
  const stopped = await observe(ok, a, first.task.id);
  assert.equal(stopped.teamGoal.status, 'paused');
  assert.throws(() => process.kill(child, 0), { code: 'ESRCH' });
  assert.equal((await observe(ok, b, parallel.task.id)).teamGoal.status, 'completed');
  const reopened = await box.open();
  assert.equal(reopened.ok('sessions.history', { ...a, before: null }).teamGoal.status, 'paused');
  assert.equal(reopened.call('tasks.submit', params).error.code, 'conflict');
  const next = reopened.ok('tasks.submit', { ...params, requestId: 'resume', teamGoal: 'resume' });
  assert.equal(next.teamGoal.id, first.teamGoal.id);
  assert.notEqual(next.task.id, first.task.id);
  const result = await observe(reopened.ok, a, next.task.id);
  assert.equal(result.teamGoal.status, 'completed');
  assert.equal(result.teamGoal.round, 2);
});

test('the same independent rejection blocks a goal instead of repeatedly executing', { timeout: 30000 }, async t => {
  const box = await isolated(t);
  const { ok, scopes: [a] } = await box.open();
  const start = ok('tasks.submit', { ...a, text: 'N01_GOAL_BLOCK', requestId: 'blocked', teamGoal: 'start' });
  const result = await observe(ok, a, start.task.id);
  assert.equal(result.teamGoal.status, 'blocked');
  assert.equal(result.teamGoal.round, 2);
  assert.equal(result.teamGoal.errorCode, 'verification_rejected');
  assert.ok(!result.events.some(e => e.type === 'text_delta'));
});
