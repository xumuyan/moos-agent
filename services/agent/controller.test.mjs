import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createController } from './controller.mjs';
import { Store } from './store.mjs';

test('existing snapshot command provides a task-scoped timeline without provider metadata', async t => {
  const { controller, dataDir } = await fixture(t, async () => ({ text: 'done' }));
  const db = new Store({ dbPath: join(dataDir, 'moos.sqlite') });
  t.after(() => db.close());
  const snapshot = await controller.request('snapshot');
  const c = snapshot.conversations[0];
  const task = db.createTask({ conversationId: c.id, message: 'read' });
  db.appendEvent(task.id, 'text_delta', { delta: '公开文字' });
  const result = await controller.request('snapshot', { conversationId: c.id, taskTimeline: { taskId: task.id } });
  assert.equal(result.taskTimeline.events[0].payload.delta, '公开文字');
  assert.equal(result.providers, undefined);
  assert.equal(result.taskTimeline.taskId, task.id);
});

test('snapshot bounds persisted multi-project history and exposes scoped pages using the existing method', async t => {
  const { controller, dataDir } = await fixture(t, async () => ({ text: 'done' }));
  const db = new Store({ dbPath: join(dataDir, 'moos.sqlite') });
  t.after(() => db.close());
  const initial = await controller.request('snapshot');
  const first = initial.conversations[0];
  const secondProject = await controller.request('add_project', { path: dataDir });
  const second = await controller.request('create_conversation', { projectId: secondProject.id });
  for (const conversation of [first, second]) {
    const task = db.createTask({ conversationId: conversation.id, message: 'task' });
    db.updateTask(task.id, { status: 'succeeded' });
    for (let i = 0; i < 100; i++) {
      db.addMessage({ conversationId: conversation.id, role: 'tool', content: `${i}:` + 'x'.repeat(30000) });
      db.appendEvent(task.id, 'tool_update', { output: 'x'.repeat(30000) });
    }
  }
  const snapshot = await controller.request('snapshot');
  assert(Buffer.byteLength(JSON.stringify(snapshot)) < 1024 * 1024);
  assert.equal(snapshot.projects.length, 2);
  assert.equal(snapshot.conversations.length, 2);
  for (const conversation of [first, second]) {
    assert(snapshot.messages.some(m => m.conversationId === conversation.id && m.content.startsWith('99:')));
    assert(snapshot.tasks.some(task => task.conversationId === conversation.id));
    const info = snapshot.history.pages.find(page => page.conversationId === conversation.id);
    assert.equal(info.messages.hasMore, true);
    const older = await controller.request('snapshot', { conversationId: conversation.id, before: { messages: info.messages.before } });
    assert(older.messages.every(m => m.conversationId === conversation.id));
    assert(!older.messages.some(m => snapshot.messages.some(current => current.id === m.id)));
    assert.equal(older.projects.length, 2);
    assert.equal(older.conversations.length, 2);
  }
  await assert.rejects(controller.request('snapshot', { before: { events: 1 } }), /conversation/i);
  await assert.rejects(controller.request('snapshot', { conversationId: first.id, before: { events: -1 } }), /cursor/i);
});

test('task timeout policy persists and is passed to newly submitted tasks', async t => {
  let received;
  const { controller, dataDir, submit } = await fixture(t, async context => { received = context.task.timeoutMs; return { text: 'done' }; });
  assert.equal((await controller.request('snapshot')).runtime.taskTimeoutMs, 7200000);
  for (const taskTimeoutMs of [0, 1, 600001, 86400001, Infinity, '7200000']) {
    await assert.rejects(controller.request('set_task_policy', { taskTimeoutMs }), /task timeout/i);
  }
  assert.equal((await controller.request('set_task_policy', { taskTimeoutMs: 21600000 })).taskTimeoutMs, 21600000);
  const task = await submit();
  await settled(controller, task);
  assert.equal(received, 21600000);
  assert.equal((await controller.request('snapshot')).tasks.find(item => item.id === task.id).timeoutMs, 21600000);
  await controller.close();
  const reopened = await createController({ dataDir, run: async () => ({ text: 'done' }) });
  t.after(() => reopened.close());
  assert.equal((await reopened.request('snapshot')).runtime.taskTimeoutMs, 21600000);
});

test('valid usage events persist, filter, export and clear without exposing prompts or credentials', async t => {
  const { controller, submit } = await fixture(t, async ({ emit }) => {
    emit('usage', { inputTokens: 80, outputTokens: 20, cacheReadTokens: 20, cacheWriteTokens: null,
      reasoningTokens: null, totalTokens: 120, providerCostUsd: 0.0012 });
    return { text: 'done' };
  });
  const task = await submit('USAGE_SECRET');
  const state = await settled(controller, task);
  assert.equal(state.usageContexts[0].totalTokens, 120);
  assert.equal(state.usageContexts[0].cacheHitRate, 0.2);
  const summary = await controller.request('get_usage', { range: 'all', providerId: 'test' });
  assert.equal(summary.recordCount, 1);
  assert.equal(summary.costUsd, 0.0012);
  assert.equal(summary.contextWindow, 128000);
  const exported = await controller.request('export_usage');
  assert.equal(exported.records.length, 1);
  assert(!JSON.stringify(exported).includes('Do work'));
  assert(!JSON.stringify(exported).includes('USAGE_SECRET'));
  assert.equal((await controller.request('clear_usage')).removed, 1);
  assert.equal((await controller.request('get_usage', { range: 'all' })).recordCount, 0);
  await assert.rejects(controller.request('get_usage', { range: 'forever' }), /usage/i);
});

const provider = id => ({ id, baseUrl: 'http://127.0.0.1:9000/v1', model: 'test', api: 'openai-completions' });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
async function fixture(t, run, settings = {}) {
  const root = await mkdtemp(join(tmpdir(), 'moos-controller-'));
  const dataDir = join(root, 'data');
  const controller = await createController({ dataDir, run, ...settings });
  t.after(async () => { await controller.close(); await rm(root, { recursive: true, force: true }); });
  const project = await controller.request('add_project', { path: root });
  const conversation = await controller.request('create_conversation', { projectId: project.id });
  await controller.request('save_provider', { provider: provider('test') });
  return { controller, dataDir, submit: (apiKey = 'SECRET') => controller.request('submit', {
    conversationId: conversation.id, message: 'Do work', providerId: 'test', apiKey,
  }) };
}
async function settled(controller, task) {
  for (let i = 0; i < 200; i++) {
    const snapshot = await controller.request('snapshot');
    if (['succeeded', 'failed', 'cancelled'].includes(snapshot.tasks.find(item => item.id === task.id)?.status)) return snapshot;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('Task did not settle');
}

test('submit caps total active work at 128 without partial task or message writes', async t => {
  const started = deferred(), release = deferred();
  const { controller, dataDir, submit } = await fixture(t, async () => { started.resolve(); await release.promise; return { text: 'done' }; });
  t.after(() => release.resolve());
  try {
    await submit();
    await started.promise;
    for (let i = 1; i < 128; i++) await submit();
    const db = new Store({ dbPath: join(dataDir, 'moos.sqlite') });
    try {
      const count = db.listMessages(db.listTasks()[0].conversationId).length;
      await assert.rejects(submit(), /active|limit|上限/i);
      assert.equal(db.listTasks().length, 128);
      assert.equal(db.listMessages(db.listTasks()[0].conversationId).length, count);
      const snapshot = await controller.request('snapshot');
      assert.equal(snapshot.tasks.length, 128);
      assert(Buffer.byteLength(JSON.stringify(snapshot)) < 1024 * 1024);
    } finally { db.close(); }
  } finally { release.resolve(); }
});

test('admitted worst-case metadata remains below snapshot cap and rejects oversized provider metadata before write', async t => {
  const { controller, dataDir } = await fixture(t, async () => ({ text: 'done' }));
  const project = (await controller.request('snapshot')).projects[0];
  await assert.rejects(controller.request('create_conversation', { projectId: project.id, title: 'x'.repeat(1000000) }), /title/i);
  for (let i = 1; i < 128; i++) await controller.request('create_conversation', { projectId: project.id, title: '\u0001'.repeat(200) });
  await assert.rejects(controller.request('create_conversation', { projectId: project.id }), /limit|budget/i);
  await assert.rejects(controller.request('save_provider', { provider: { ...provider('huge'), baseUrl: 'https://example.com/' + 'x'.repeat(1000000) } }), /地址|metadata|budget/i);
  for (let i = 1; i < 32; i++) await controller.request('save_provider', { provider: { ...provider(`p${i}`), name: '"'.repeat(100), model: '"'.repeat(200), baseUrl: 'https://example.com/' + 'x'.repeat(2000) } });
  await assert.rejects(controller.request('save_provider', { provider: provider('overflow') }), /limit|budget/i);
  const snapshot = await controller.request('snapshot');
  assert.equal(snapshot.conversations.length, 128);
  assert.equal(snapshot.providers.length, 32);
  assert(Buffer.byteLength(JSON.stringify(snapshot)) < 1024 * 1024 - 4096);
  const db = new Store({ dbPath: join(dataDir, 'moos.sqlite') });
  try {
    for (const conversation of snapshot.conversations) {
      const task = db.createTask({ conversationId: conversation.id, message: 'x'.repeat(100000) });
      db.addMessage({ conversationId: conversation.id, role: 'user', content: 'x'.repeat(100000) });
      db.appendEvent(task.id, 'tool_update', { text: 'x'.repeat(100000) });
    }
    const busy = await controller.request('snapshot');
    assert.equal(busy.tasks.length, 128);
    assert(Buffer.byteLength(JSON.stringify(busy)) < 1024 * 1024 - 4096);
  } finally { db.close(); }
});

test('stream redaction retains only a bounded suffix and removes keys at every split', async t => {
  const checkpoint = deferred();
  const resume = deferred();
  t.after(() => resume.resolve());
  const { controller, submit } = await fixture(t, async ({ emit, apiKey }) => {
    emit('text_delta', { delta: 'ordinary '.repeat(1000) + 'SEC' });
    checkpoint.resolve();
    await resume.promise;
    emit('usage', { input: 1 });
    emit('text_delta', { delta: 'RET!' });
    for (let split = 1; split < apiKey.length; split++) {
      emit('text_delta', { delta: apiKey.slice(0, split) });
      emit('text_delta', { delta: apiKey.slice(split) + '|' });
    }
    emit('text_delta', { delta: 'tail SE' });
    return { text: 'SECRET done' };
  });
  const task = await submit();
  await checkpoint.promise;
  const live = await controller.request('snapshot');
  assert.equal(live.events.filter(e => e.type === 'text_delta').map(e => e.payload.delta).join(''), 'ordinary '.repeat(1000));
  resume.resolve();
  const snapshot = await settled(controller, task);
  assert.equal(snapshot.tasks[0].status, 'succeeded');
  assert.equal(snapshot.events.filter(e => e.type === 'text_delta').map(e => e.payload.delta).join(''),
    'ordinary '.repeat(1000) + '[REDACTED]!' + '[REDACTED]|'.repeat(5) + 'tail SE');
  assert(snapshot.messages.some(m => m.content === '[REDACTED] done'));
  assert.equal(JSON.stringify(snapshot).includes('SECRET'), false);
});

test('tool output redaction protects split nested strings without changing metadata or schemas', async t => {
  const { controller, submit } = await fixture(t, async ({ emit }) => {
    emit('tool_start', { toolCallId: 'call1', toolName: 'bash', args: { command: 'printf SECRET' } });
    emit('tool_update', { toolCallId: 'call1', partialResult: { content: [{ type: 'text', text: 'SEC' }], details: { output: 'SEC' } } });
    emit('tool_update', { toolCallId: 'call1', partialResult: { content: [{ type: 'text', text: 'RET' }], details: { output: 'RET' } } });
    emit('tool_update', { toolCallId: 'call2', partialResult: { content: [{ type: 'text', text: 'normal output' }], details: { count: 2 } } });
    emit('tool_end', { toolCallId: 'call1', toolName: 'bash', result: { content: [{ type: 'text', text: 'SECRET' }] }, isError: false });
    return { text: 'done' };
  });
  const snapshot = await settled(controller, await submit());
  const updates = snapshot.events.filter(e => e.type === 'tool_update').map(e => e.payload);
  assert.equal(updates.slice(0, 2).map(e => e.partialResult.content[0].text).join('').includes('SECRET'), false);
  assert.equal(updates.slice(0, 2).map(e => e.partialResult.details.output).join('').includes('SECRET'), false);
  for (const update of updates) {
    assert.deepEqual(Object.keys(update).sort(), ['partialResult', 'toolCallId']);
    assert.equal(update.partialResult.content[0].type, 'text');
  }
  assert.deepEqual(updates[2], { toolCallId: 'call2', partialResult: { content: [{ type: 'text', text: 'normal output' }], details: { count: 2 } } });
  assert.equal(JSON.stringify(snapshot).includes('SECRET'), false);
});

test('concurrent provider writes serialize save and remove without losing persisted updates', async t => {
  const { controller, dataDir } = await fixture(t, async () => ({ text: 'done' }));
  await Promise.all([
    controller.request('save_provider', { provider: provider('a') }),
    controller.request('remove_provider', { providerId: 'test' }),
    controller.request('save_provider', { provider: provider('b') }),
    controller.request('remove_provider', { providerId: 'a' }),
  ]);
  const snapshot = await controller.request('snapshot');
  assert.deepEqual(snapshot.providers.map(p => p.id), ['b']);
  assert.deepEqual(JSON.parse(await readFile(join(dataDir, 'providers.json'), 'utf8')), snapshot.providers);
});

test('failed provider persistence does not publish next state and does not poison later writes', async t => {
  const { controller, dataDir } = await fixture(t, async () => ({ text: 'done' }));
  const file = join(dataDir, 'providers.json');
  await rm(file);
  await mkdir(file);
  const saving = controller.request('save_provider', { provider: provider('a') });
  const rejected = assert.rejects(saving);
  assert.deepEqual((await controller.request('snapshot')).providers.map(p => p.id), ['test']);
  await rejected;
  assert.deepEqual((await controller.request('snapshot')).providers.map(p => p.id), ['test']);
  await assert.rejects(controller.request('remove_provider', { providerId: 'test' }));
  assert.deepEqual((await controller.request('snapshot')).providers.map(p => p.id), ['test']);
  await rm(file, { recursive: true });
  await controller.request('save_provider', { provider: provider('b') });
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).map(p => p.id), ['test', 'b']);
});

test('concurrent close callers wait for the same shutdown and requests reject while closing', async t => {
  const started = deferred();
  const release = deferred();
  const { controller, submit } = await fixture(t, async () => { started.resolve(); await release.promise; return { text: 'done' }; });
  await submit();
  await started.promise;
  const first = controller.close();
  const second = controller.close();
  try {
    assert.equal(first, second);
    await assert.rejects(controller.request('snapshot'));
    let finished = false;
    second.then(() => { finished = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(finished, false);
  } finally { release.resolve(); await Promise.all([first, second]); }
  await controller.close();
  await assert.rejects(controller.request('snapshot'));
});

test('shutdown timeout rejects all close callers but permits a later shutdown retry', async t => {
  const started = deferred();
  const release = deferred();
  const { controller, submit } = await fixture(t, async () => { started.resolve(); await release.promise; return { text: 'done' }; }, { shutdownTimeoutMs: 20 });
  await submit();
  await started.promise;
  const first = controller.close();
  const second = controller.close();
  // Release after a bound even against the old hard-coded 15-second timeout.
  const timer = setTimeout(() => release.resolve(), 100);
  try {
    const results = await Promise.allSettled([first, second]);
    assert.deepEqual(results.map(r => r.status), ['rejected', 'rejected']);
    assert.match(results[0].reason.message, /尚未停止/);
    await assert.rejects(controller.request('snapshot'));
    await assert.rejects(controller.close(), /尚未停止/);
  } finally { clearTimeout(timer); release.resolve(); }
  await controller.close();
  await assert.rejects(controller.request('snapshot'));
});

test('controller keeps credentials out of snapshots and disk and restores project history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'moos-controller-'));
  const project = join(root, 'project');
  await mkdir(project);
  let received;
  const run = async options => {
    received = options;
    options.emit('tool_end', { result: options.apiKey });
    return { text: 'Done' };
  };
  let controller;
  try {
    controller = await createController({ dataDir: join(root, 'data'), run });
    await controller.request('save_provider', { provider: { id: 'test', name: 'Test', baseUrl: 'http://127.0.0.1:9000/v1', model: 'test', api: 'openai-completions' } });
    const added = await controller.request('add_project', { path: project });
    const conversation = await controller.request('create_conversation', { projectId: added.id });
    const task = await controller.request('submit', { conversationId: conversation.id, message: 'Do work', providerId: 'test', apiKey: 'SECRET_ONLY_MEMORY' });
    for (let i = 0; i < 100; i++) {
      const state = await controller.request('snapshot');
      if (state.tasks.find(item => item.id === task.id)?.status === 'succeeded') break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const snapshot = await controller.request('snapshot');
    assert.equal(snapshot.tasks.find(item => item.id === task.id).status, 'succeeded');
    assert.equal(received.apiKey, 'SECRET_ONLY_MEMORY');
    assert.equal(received.task.text, 'Do work');
    assert.equal(received.provider.contextWindow, 128000);
    assert.equal(received.provider.maxTokens, 8192);
    assert.equal(JSON.stringify(snapshot).includes('SECRET_ONLY_MEMORY'), false);
    assert.equal((await readFile(join(root, 'data', 'providers.json'), 'utf8')).includes('SECRET_ONLY_MEMORY'), false);
    await assert.rejects(controller.request('save_provider', { provider: { id: '../bad', baseUrl: 'http://public.example/v1', model: 'x' } }));
    await assert.rejects(controller.request('unknown'));
    await controller.close();
    controller = await createController({ dataDir: join(root, 'data'), run });
    const restored = await controller.request('snapshot');
    assert.equal(restored.projects.length, 1);
    assert(restored.messages.some(message => message.content === 'Done'));
  } finally {
    await controller?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('renaming through controller is visible in snapshot without creating a new conversation', async t => {
  const { controller } = await fixture(t, async () => ({ text: 'done' }));
  const before = await controller.request('snapshot');
  const c = before.conversations[0];
  await controller.request('rename_conversation', { projectId: c.projectId, conversationId: c.id, title: '开发任务' });
  const after = await controller.request('snapshot');
  assert.equal(after.conversations.length, before.conversations.length);
  assert.equal(after.conversations.find(item => item.id === c.id).title, '开发任务');
});
