import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile, stat, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './store.mjs';
import { DatabaseSync } from 'node:sqlite';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'moos-store-'));
  const path = join(root, 'project');
  await mkdir(path);
  const dbPath = join(root, 'history.sqlite');
  const store = new Store({ dbPath });
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  return { root, path, dbPath, store };
}

test('canonical projects validate directories and deduplicate symlinks including concurrent additions', async t => {
  const { root, path, store } = await fixture(t);
  await symlink(path, join(root, 'alias'));
  const projects = await Promise.all([store.addProject(path), store.addProject(join(root, 'alias'))]);
  assert.equal(projects[0].id, projects[1].id);
  assert.equal(projects[0].path, await realpath(path));
  assert.equal(projects[0].name, 'project');
  assert.equal(store.listProjects().length, 1);
  await writeFile(join(root, 'file'), 'source');
  await assert.rejects(store.addProject(join(root, 'file')), /directory/i);
  await assert.rejects(store.addProject(join(root, 'missing')), /directory/i);
});

test('legacy task schema migrates heartbeat, timeout, stage, error code and settings', async t => {
  const root = await mkdtemp(join(tmpdir(), 'moos-store-migration-'));
  const dbPath = join(root, 'legacy.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, createdAt TEXT NOT NULL);
    CREATE TABLE conversations (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, title TEXT NOT NULL, createdAt TEXT NOT NULL);
    CREATE TABLE tasks (id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, conversationId TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, message TEXT NOT NULL, status TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, error TEXT);
  `);
  db.close();
  const store = new Store({ dbPath });
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  const inspection = new DatabaseSync(dbPath);
  const columns = new Set(inspection.prepare('PRAGMA table_info(tasks)').all().map(column => column.name));
  inspection.close();
  for (const name of ['timeoutMs', 'heartbeatAt', 'stage', 'errorCode']) assert(columns.has(name), name);
  store.setSetting('taskTimeoutMs', '21600000');
  assert.equal(store.getSetting('taskTimeoutMs'), '21600000');
});

test('usage records aggregate by range and scope, export without prompts, clear and cascade', async t => {
  const { path, store } = await fixture(t);
  const project = await store.addProject(path);
  const conversation = store.createConversation(project.id);
  const first = store.createTask({ conversationId: conversation.id, message: 'first' });
  const second = store.createTask({ conversationId: conversation.id, message: 'second' });
  const base = { providerId: 'provider', model: 'model', projectId: project.id, conversationId: conversation.id,
    inputTokens: 80, outputTokens: 20, cacheReadTokens: 20, cacheWriteTokens: null,
    reasoningTokens: null, totalTokens: 120, contextWindow: 1000, costUsd: 0.01,
    costSource: 'provider', priceVersion: null };
  store.recordUsage({ ...base, taskId: first.id, createdAt: '2026-11-05T01:00:00.000Z' });
  store.recordUsage({ ...base, taskId: second.id, inputTokens: 40, outputTokens: 10, cacheReadTokens: null,
    totalTokens: 50, costUsd: null, costSource: null, createdAt: '2026-11-05T02:00:00.000Z' });
  const summary = store.usageSummary({ since: '2026-11-05T00:00:00.000Z', providerId: 'provider' });
  assert.equal(summary.recordCount, 2);
  assert.equal(summary.inputTokens, 120);
  assert.equal(summary.cacheReadTokens, null);
  assert.equal(summary.cacheHitRate, null);
  assert.equal(summary.costUsd, null);
  assert.equal(store.latestUsageContexts()[0].conversationId, conversation.id);
  const exported = store.exportUsage({ limit: 10 });
  assert.equal(exported.records.length, 2);
  assert(!JSON.stringify(exported).includes('first'));
  assert.throws(() => store.usageSummary({ since: 'not-a-date' }), /usage/i);
  assert.equal(store.clearUsage(), 2);
  assert.equal(store.usageSummary({}).recordCount, 0);
  store.recordUsage({ ...base, taskId: first.id });
  store.updateTask(first.id, { status: 'cancelled' });
  store.updateTask(second.id, { status: 'cancelled' });
  store.removeProject(project.id);
  assert.equal(store.exportUsage({}).records.length, 0);
});

test('history survives reopening; recovery is explicit and emits terminal events', async t => {
  const { path, dbPath, store } = await fixture(t);
  const p = await store.addProject(path);
  const c = store.createConversation(p.id);
  assert.equal(c.title, '新会话');
  const task = store.createTask({ conversationId: c.id, message: 'hello' });
  store.addMessage({ conversationId: c.id, taskId: task.id, role: 'user', content: 'hello' });
  store.updateTask(task.id, { status: 'running' });
  const event = store.appendEvent(task.id, 'output', { text: 'hi' });
  assert.equal(typeof event.id, 'number');
  assert.deepEqual(event.payload, { text: 'hi' });
  store.close();
  const reopened = new Store({ dbPath });
  t.after(() => reopened.close());
  assert.equal(reopened.getTask(task.id).status, 'running');
  assert.equal(reopened.listMessages(c.id)[0].content, 'hello');
  assert.equal(reopened.listConversations(p.id)[0].id, c.id);
  assert.equal(reopened.listTasks()[0].id, task.id);
  assert.equal(reopened.getProject(p.id).path, await realpath(path));
  assert.equal(reopened.getConversation(c.id).projectId, p.id);
  assert.deepEqual(reopened.listEvents(task.id)[0], event);
  assert.deepEqual(reopened.listEvents(undefined, event.id), []);
  reopened.interruptUnfinished();
  assert.equal(reopened.getTask(task.id).status, 'interrupted');
  assert.equal(reopened.listEvents(task.id, event.id)[0].payload.status, 'interrupted');
  reopened.interruptUnfinished();
  assert.equal(reopened.listEvents().length, 2);
});

test('project deletion rejects active tasks then cascades metadata without touching source', async t => {
  const { path, store } = await fixture(t);
  const p = await store.addProject(path);
  const c = store.createConversation(p.id, 'work');
  const task = store.createTask({ conversationId: c.id, message: 'work' });
  store.appendEvent(task.id, 'output', {});
  store.addMessage({ conversationId: c.id, taskId: task.id, role: 'user', content: 'work' });
  assert.throws(() => store.removeProject(p.id), /active/i);
  store.updateTask(task.id, { status: 'running' });
  assert.throws(() => store.removeProject(p.id), /active/i);
  store.updateTask(task.id, { status: 'succeeded' });
  store.removeProject(p.id);
  assert.deepEqual(store.listProjects(), []);
  assert.deepEqual(store.listTasks(), []);
  assert.deepEqual(store.listEvents(), []);
  assert.throws(() => store.listMessages(c.id), /not found/i);
  assert.equal((await stat(path)).isDirectory(), true);
});

test('bounded history pages retain every older row and chunk giant JSON without data loss', async t => {
  const { path, dbPath, store } = await fixture(t);
  const project = await store.addProject(path);
  const conversation = store.createConversation(project.id);
  const task = store.createTask({ conversationId: conversation.id, message: 'work' });
  const content = '你好\\\"\n'.repeat(500000);
  const messages = [];
  for (let i = 0; i < 60; i++) messages.push(store.addMessage({ conversationId: conversation.id, role: 'tool', content: `${i}:` + content.slice(0, 90000) }));
  const giant = store.appendEvent(task.id, 'tool_update', { text: content });
  store.close();
  assert((await stat(dbPath)).size > 4 * 1024 * 1024);
  const reopened = new Store({ dbPath });
  t.after(() => reopened.close());
  let before;
  const seen = new Set();
  do {
    const page = reopened.snapshotHistory({ conversationId: conversation.id, before });
    assert(Buffer.byteLength(JSON.stringify(page)) < 1024 * 1024);
    for (const message of page.messages) { assert(!seen.has(message.id)); seen.add(message.id); }
    const info = page.history.pages[0].messages;
    before = info.hasMore ? { messages: info.before } : undefined;
  } while (before);
  assert.equal(seen.size, 60);
  const page = reopened.snapshotHistory({ conversationId: conversation.id });
  assert.equal(page.history.pages[0].events.truncatedRows[0].id, giant.id);
  let offset = 0, json = '', revision;
  do {
    const part = reopened.snapshotHistory({ conversationId: conversation.id, historyRow: { collection: 'events', id: giant.id, offset, revision } });
    revision = part.history.row.revision;
    assert(Buffer.byteLength(JSON.stringify(part)) < 1024 * 1024);
    json += part.history.row.json;
    offset = part.history.row.nextOffset;
  } while (offset !== null);
  assert.deepEqual(JSON.parse(json), giant);
  const other = reopened.createConversation(project.id);
  assert.throws(() => reopened.snapshotHistory({ conversationId: other.id, before: { messages: messages[0].id } }), /cursor/i);
  assert.throws(() => reopened.snapshotHistory({ conversationId: other.id, historyRow: { collection: 'events', id: giant.id, offset: 0 } }), /conversation/i);
});

test('event and task cursors walk older rows without overlap after new writes', async t => {
  const { path, store } = await fixture(t);
  const project = await store.addProject(path);
  const conversation = store.createConversation(project.id);
  for (let i = 0; i < 65; i++) {
    const task = store.createTask({ conversationId: conversation.id, message: `task ${i}` });
    store.updateTask(task.id, { status: 'succeeded' });
    store.appendEvent(task.id, 'output', { index: i });
  }
  const recent = store.snapshotHistory({ conversationId: conversation.id });
  const info = recent.history.pages[0];
  const task = store.createTask({ conversationId: conversation.id, message: 'new arrival' });
  store.updateTask(task.id, { status: 'succeeded' });
  store.appendEvent(task.id, 'output', { index: 65 });
  const older = store.snapshotHistory({ conversationId: conversation.id, before: { tasks: info.tasks.before, events: info.events.before } });
  assert.equal(recent.tasks.length, 50);
  assert.equal(older.tasks.length, 15);
  assert.equal(older.events.length, 15);
  assert.equal(older.history.pages[0].tasks.hasMore, false);
  assert.equal(older.history.pages[0].events.hasMore, false);
  assert.equal(new Set([...recent.tasks, ...older.tasks].map(row => row.id)).size, 65);
  assert.deepEqual([...older.events, ...recent.events].map(event => event.payload.index), Array.from({ length: 65 }, (_, i) => i));
  for (const params of [
    { before: { events: 0 } }, { before: { tasks: 'missing' } }, { before: { unknown: 1 } },
    { historyRow: { collection: 'projects', id: project.id } },
    { historyRow: { collection: 'tasks', id: task.id, offset: -1 } },
  ]) assert.throws(() => store.snapshotHistory({ conversationId: conversation.id, ...params }), /cursor/i);
});

test('active tasks survive newer terminal pages with bounded giant descriptors', async t => {
  const { path, store } = await fixture(t);
  const p = await store.addProject(path), c = store.createConversation(p.id);
  const active = store.createTask({ conversationId: c.id, message: 'x'.repeat(2000000) });
  store.updateTask(active.id, { status: 'running' });
  for (let i = 0; i < 60; i++) {
    const task = store.createTask({ conversationId: c.id, message: 'done' });
    store.updateTask(task.id, { status: 'cancelled' });
  }
  const first = store.snapshotHistory();
  for (const snapshot of [first, store.snapshotHistory({ conversationId: c.id, before: { tasks: first.history.pages[0].tasks.before } })]) {
    assert.equal(snapshot.tasks.filter(task => task.id === active.id).length, 1);
    assert.equal(snapshot.tasks.find(task => task.id === active.id).status, 'running');
    assert(snapshot.history.pages[0].tasks.truncatedRows.some(row => row.id === active.id));
    assert(Buffer.byteLength(JSON.stringify(snapshot)) < 1024 * 1024);
  }
});

test('mutable row chunks require a matching revision and reject stale continuations', async t => {
  const { path, store } = await fixture(t);
  const p = await store.addProject(path), c = store.createConversation(p.id);
  const task = store.createTask({ conversationId: c.id, message: 'x'.repeat(100000) });
  const read = historyRow => store.snapshotHistory({ conversationId: c.id, historyRow }).history.row;
  const first = read({ collection: 'tasks', id: task.id });
  assert.equal(typeof first.revision, 'string');
  assert.throws(() => read({ collection: 'tasks', id: task.id, offset: first.nextOffset }), /revision/i);
  const second = read({ collection: 'tasks', id: task.id, offset: first.nextOffset, revision: first.revision });
  assert.equal(second.revision, first.revision);
  store.updateTask(task.id, { status: 'succeeded' });
  assert.throws(() => read({ collection: 'tasks', id: task.id, offset: first.nextOffset, revision: first.revision }), /stale.*revision/i);
  assert.notEqual(read({ collection: 'tasks', id: task.id }).revision, first.revision);
});

test('metadata is bounded before writing and collection exhaustion preserves readable snapshots', async t => {
  const { path, store } = await fixture(t);
  const p = await store.addProject(path);
  assert.throws(() => store.createConversation(p.id, 'x'.repeat(201)), /title/i);
  assert.equal(store.listConversations(p.id).length, 0);
  for (let i = 0; i < 128; i++) store.createConversation(p.id, '\u0001'.repeat(200));
  assert.throws(() => store.createConversation(p.id), /limit|budget/i);
  assert.equal(store.listConversations(p.id).length, 128);
  assert(Buffer.byteLength(JSON.stringify(store.snapshotHistory())) < 1024 * 1024);
});

test('invalid IDs and cross-conversation messages fail safely without partial writes', async t => {
  const { path, store } = await fixture(t);
  const p = await store.addProject(path);
  const c = store.createConversation(p.id);
  const other = store.createConversation(p.id);
  const task = store.createTask({ conversationId: c.id, message: 'a' });
  for (const action of [
    () => store.getProject('missing'), () => store.getConversation('missing'),
    () => store.getTask('missing'), () => store.removeProject('missing'),
    () => store.createConversation('missing'), () => store.listConversations('missing'),
    () => store.listMessages('missing'), () => store.listEvents('missing'),
    () => store.createTask({ conversationId: 'missing', message: 'a' }),
    () => store.updateTask('missing', { status: 'failed' }),
    () => store.appendEvent('missing', 'x', {}),
    () => store.addMessage({ conversationId: c.id, taskId: 'missing', role: 'user', content: 'x' }),
  ]) assert.throws(action, /not found/i);
  assert.throws(() => store.addMessage({ conversationId: other.id, taskId: task.id, role: 'user', content: 'x' }), /conversation/i);
  assert.throws(() => store.updateTask(task.id, { status: 'bogus' }), /status/i);
  assert.deepEqual(store.listMessages(other.id), []);
});
