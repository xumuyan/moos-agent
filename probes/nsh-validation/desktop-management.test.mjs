import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lstat, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { startDesktopHost } from './desktop-host.mjs';

const call = (host, method, params = {}) => host.call({ version: 1, id: 'check', method, params });
function result(host, method, params) {
  const response = call(host, method, params);
  assert.ok(response.ok, JSON.stringify(response.error));
  return response.result;
}
const code = (host, method, params) => call(host, method, params).error?.code;
const model = { id: null, label: 'Fixture Relay Model', model: 'relay-sol', imageInput: true,
  contextWindow: 256000, maxTokens: 16384, efforts: ['off', 'low', 'high'], defaultEffort: 'high' };
const service = { id: null, name: 'Relay A', baseUrl: 'https://relay.example.invalid/v1',
  service: 'openai', api: 'openai-responses', apiKey: 'local-synthetic-fixture-only' };

async function profile(t, options) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'n01-management-')));
  let active;
  t.after(async () => {
    await active?.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, launch: async () => (active = await startDesktopHost({ ...options, profileDir: root })) };
}
function scopeFor(host, projectIndex = 0) {
  const projectId = result(host, 'projects.list').projects[projectIndex].id;
  const sessionId = result(host, 'sessions.list', { projectId }).sessions[0].id;
  return { projectId, sessionId };
}
async function drain(host, scope, taskId) {
  const end = Date.now() + 24000;
  const events = [];
  let cursor = null;
  while (Date.now() < end) {
    const page = result(host, 'tasks.events', { ...scope, taskId, cursor, limit: 100 });
    events.push(...page.events);
    if (page.terminal && !page.hasMore) return { ...page, events };
    cursor = page.cursor;
    await delay(25);
  }
  assert.fail('task did not drain');
}

test('NSH model sites persist independently and never return keys; the selected effort routes into PI', async t => {
  const observations = [];
  const { root, launch } = await profile(t, { run: async input => {
    observations.push({ model: input.provider.model, level: input.provider.thinkingLevel, key: input.apiKey });
    return { text: 'isolated route checked' };
  } });
  let host = await launch();
  assert.equal(result(host, 'projects.list').desktopManagement, true);
  const save = (service, model) => result(host, 'models.manage', { action: 'save', service, model });
  assert.equal(code(host, 'models.manage', { action: 'save', service: { ...service, baseUrl: 'http://relay.example.invalid' }, model }), 'invalid_request');
  const created = save(service, model);
  const group = created.services[0];
  assert.equal(group.hasKey, true);
  assert.ok(!JSON.stringify(created).includes(service.apiKey));
  const firstModel = group.models[0];
  save({ ...group, apiKey: '' }, { ...model, model: 'relay-astra', label: 'Astra', efforts: ['off'] , defaultEffort: 'off' });
  const edited = save({ ...group, name: 'Relay A renamed', apiKey: '' }, { ...firstModel, label: 'Sol edited' });
  save({ ...service, name: 'Relay B' }, { ...model, label: 'Same model at B' });
  assert.notEqual(edited.models.options.at(-1)?.id, firstModel.id);
  assert.equal(edited.services[0].models.length, 2);
  const privateFile = await lstat(join(root, 'private', 'credentials.json'));
  assert.equal(privateFile.mode & 0o777, 0o600);
  assert.equal((await lstat(join(root, 'private'))).mode & 0o777, 0o700);
  await host.close();
  host = await launch();
  const after = result(host, 'models.manage', { action: 'list' });
  assert.deepEqual(after.services.map(group => [group.name, group.models.length]), [['Relay A renamed', 2], ['Relay B', 1]]);
  assert.equal(after.models.options.find(m => m.id === firstModel.id).label, 'Sol edited');
  assert.ok(!JSON.stringify(after).includes(service.apiKey));
  const scope = scopeFor(host);
  const { task } = result(host, 'tasks.submit', { ...scope, text: 'verify configured route', requestId: 'route',
    modelId: firstModel.id, reasoningEffort: 'low' });
  assert.equal((await drain(host, scope, task.id)).task.status, 'succeeded');
  assert.deepEqual(observations, [{ model: model.model, level: 'low', key: service.apiKey }]);
});

test('NSH sessions preserve history and ownership across archive, restart and restore', async t => {
  const { launch } = await profile(t, { run: async () => ({ text: 'saved reply' }) });
  let host = await launch();
  const scope = scopeFor(host);
  const other = scopeFor(host, 1);
  const { task } = result(host, 'tasks.submit', { ...scope, requestId: 'first', text: 'saved prompt' });
  assert.equal((await drain(host, scope, task.id)).task.status, 'succeeded');
  const manage = (action, fields = {}) => result(host, 'sessions.manage', { ...scope, action, ...fields });
  assert.equal(code(host, 'sessions.manage', { ...scope, projectId: other.projectId, action: 'rename', title: 'outside allowed scope' }), 'not_found');
  assert.equal(manage('rename', { title: '  沐码设计  ' }).sessions[0].title, '沐码设计');
  const fork = manage('fork');
  const forkScope = { projectId: scope.projectId, sessionId: fork.selectedId };
  assert.deepEqual(result(host, 'sessions.history', { ...forkScope, before: null }).messages.map(m => [m.role, m.text]),
    [['user', 'saved prompt'], ['assistant', 'saved reply']]);
  assert.equal(result(host, 'sessions.manage', { ...forkScope, action: 'pin' }).sessions[0].pinned, true);
  assert.equal(manage('archive').sessions.length, 1);
  assert.equal(code(host, 'tasks.submit', { ...scope, requestId: 'archived', text: 'archived' }), 'not_found');
  await host.close();
  host = await launch();
  assert.equal(scopeFor(host).sessionId, forkScope.sessionId);
  const archived = projectId => result(host, 'sessions.manage', { projectId, action: 'listArchived' }).sessions;
  assert.deepEqual(archived(other.projectId), []);
  assert.deepEqual(archived(scope.projectId).map(s => s.id), [scope.sessionId]);
  assert.equal(code(host, 'sessions.manage', { ...scope, action: 'restore', projectId: other.projectId }), 'not_found');
  assert.equal(code(host, 'sessions.manage', { ...scope, action: 'listArchived' }), 'invalid_request');
  for (let i = 1; i < 16; i++) result(host, 'sessions.create', { projectId: scope.projectId, title: 'Session ' + i });
  assert.equal(code(host, 'sessions.manage', { ...scope, action: 'restore' }), 'limit');
  assert.deepEqual(archived(scope.projectId).map(s => s.id), [scope.sessionId]);
  result(host, 'sessions.manage', { ...forkScope, action: 'archive' });
  const restored = manage('restore');
  assert.equal(restored.selectedId, scope.sessionId);
  assert.deepEqual(manage('restore'), restored);
  assert.equal(result(host, 'sessions.history', { ...scope, before: null }).messages[0].text, 'saved prompt');
  await host.close();
  host = await launch();
  assert.equal(scopeFor(host).sessionId, scope.sessionId);
  assert.deepEqual(archived(scope.projectId).map(s => s.id), [forkScope.sessionId]);
});

test('first draft message is saved atomically, replayable once, and visible after restart', async t => {
  const { launch } = await profile(t, { run: async () => ({ text: 'first reply' }) });
  let host = await launch();
  const projectId = scopeFor(host).projectId;
  const other = scopeFor(host, 1).projectId;
  const scope = { projectId, sessionId: 'draft-first-checked' };
  const input = { ...scope, draft: true, requestId: 'first', text: '首条消息' };
  const imageData = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGNIn3qAJMQwqmFUw/DVAACx2bwQBikQCwAAAABJRU5ErkJggg==';
  const image = { ...scope, draft: true, batchId: 'first-image', index: 0, offset: 0, data: imageData, mime: 'image/png' };
  result(host, 'images.stage', { ...image, projectId: other });
  assert.equal(code(host, 'tasks.submit', { ...input, modelId: 'fixture-alternate', imageBatch: image.batchId }), 'not_found');
  result(host, 'images.stage', image);
  const sessions = () => result(host, 'sessions.list', { projectId }).sessions;
  assert.equal(sessions().length, 1);
  assert.equal(code(host, 'sessions.history', { ...scope, before: null }), 'not_found');
  assert.equal(code(host, 'tasks.submit', { ...input, text: '   ' }), 'invalid_request');
  assert.equal(code(host, 'tasks.submit', { ...input, modelId: 'no-model' }), 'invalid_request');
  assert.equal(code(host, 'tasks.submit', { ...input, draft: false }), 'invalid_request');
  assert.equal(sessions().length, 1);
  const commit = { ...input, modelId: 'fixture-alternate', imageBatch: image.batchId };
  const admitted = result(host, 'tasks.submit', commit);
  assert.equal(admitted.session.id, scope.sessionId);
  assert.equal(admitted.session.title, '新会话 2');
  assert.equal(sessions().length, 2);
  assert.deepEqual(result(host, 'tasks.submit', commit), { ...admitted, replayed: true });
  assert.equal(code(host, 'tasks.submit', { ...commit, projectId: other }), 'conflict');
  assert.equal(code(host, 'tasks.submit', { ...commit, requestId: 'different' }), 'conflict');
  assert.equal((await drain(host, scope, admitted.task.id)).task.status, 'succeeded');
  await host.close();
  host = await launch();
  assert.equal(sessions().length, 2);
  assert.deepEqual(result(host, 'sessions.history', { ...scope, before: null }).messages.map(m => m.text), ['首条消息', 'first reply']);
});

test('NSH images stay in their session, require a vision model and reach the real PI adapter', async t => {
  const host = await (await profile(t)).launch();
  const scope = scopeFor(host);
  const { sessionId: unrelatedSession } = scopeFor(host, 1);
  const data = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGNIn3qAJMQwqmFUw/DVAACx2bwQBikQCwAAAABJRU5ErkJggg==';
  const image = { ...scope, batchId: 'paste', index: 0, offset: 0, data, mime: 'image/png' };
  assert.equal(code(host, 'images.stage', { ...image, sessionId: unrelatedSession }), 'not_found');
  assert.equal(code(host, 'images.stage', { ...image, mime: 'image/gif' }), 'invalid_request');
  result(host, 'images.stage', image);
  assert.equal(code(host, 'images.stage', image), 'invalid_request');
  const request = { ...scope, requestId: 'paste', text: 'N01_PASTE_IMAGE', imageBatch: 'paste' };
  assert.equal(code(host, 'tasks.submit', request), 'invalid_request');
  assert.equal(code(host, 'tasks.submit', { ...request, modelId: 'fixture-alternate', teamGoal: 'start' }), 'invalid_request');
  const picked = { ...request, modelId: 'fixture-alternate' };
  const { task } = result(host, 'tasks.submit', picked);
  assert.equal(result(host, 'tasks.submit', picked).replayed, true);
  assert.equal(code(host, 'tasks.submit', { ...picked, requestId: 'reuse' }), 'not_found');
  const done = await drain(host, scope, task.id);
  assert.equal(done.task.status, 'succeeded');
  assert.equal(done.events.filter(e => e.type === 'text_delta').map(e => e.payload.delta).join(''), 'N01_IMAGE_RECEIVED');
});

test('NSH Git workspace summaries are turn-local and contain filenames and change type', async t => {
  const host = await (await profile(t)).launch();
  execFileSync('git', ['init', '-q'], { cwd: host.trustedProjects[0].path });
  const scope = scopeFor(host);
  const { task } = result(host, 'tasks.submit', { ...scope, text: 'MOOS_FIXTURE_WRITE RESULT', requestId: 'workspace' });
  const done = await drain(host, scope, task.id);
  assert.equal(done.task.status, 'succeeded');
  assert.deepEqual(done.workspaceChanges, { files: [{ path: 'result.txt', summary: '新增' }], limited: false });
});
