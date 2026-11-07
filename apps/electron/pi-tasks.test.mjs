import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { runPiSdk } from '../../packages/pi-runtime/sdk-runtime.mjs';
import { startFixture } from '../../services/agent/fixture.mjs';
import { Scheduler } from '../../services/agent/scheduler.mjs';
import { Store } from '../../services/agent/store.mjs';
import { createPiAdapter } from './plugin/pi-route.js';
import { createPiTasks } from './plugin/pi-tasks.js';

async function waitFor(check) {
  for (let i = 0; i < 150; i++) {
    const value = await check();
    if (value) return value;
    await delay(40);
  }
  assert.fail('Expected PI task state was not observed');
}

async function collect(stream) {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
}

test('Electron PI tasks serialize directory aliases, run other projects and stop only the targeted process', {
  timeout: 30000,
}, async t => {
  const data = await realpath(await mkdtemp(join(tmpdir(), 'moos-electron-dispatch-')));
  const root = join(data, 'workspaces');
  const first = join(root, 'first');
  const second = join(root, 'second');
  const alias = join(root, 'first-alias');
  await mkdir(first, { recursive: true });
  await mkdir(second);
  await symlink(first, alias);
  const dbPath = join(data, 'moos.sqlite');
  let store = new Store({ dbPath });
  const fixture = await startFixture();
  const makeTasks = () => createPiTasks({ store, Scheduler, fixtureRoot: root, run: options => runPiSdk({
    ...options, dataDir: join(data, 'pi'),
    provider: { id: 'moos-pi', name: 'Fixture', api: 'openai-completions', baseUrl: fixture.baseUrl,
      model: 'moos-fixture', contextWindow: 128000, maxTokens: 8192 },
    apiKey: fixture.apiKey,
  }) });
  let tasks = makeTasks();
  t.after(async () => {
    try { await tasks.close(); }
    finally { await fixture.close(); await rm(data, { recursive: true, force: true }); }
  });
  const signal = new AbortController().signal;
  const holder = new AbortController();
  await assert.rejects(tasks.open({ sessionId: 'outside', cwd: data, input: 'MOOS_FIXTURE_TOOLS', signal }));
  await assert.rejects(tasks.open({ sessionId: 'invalid', cwd: first, input: '任意开发任务', signal }));
  const hold = await tasks.open({ sessionId: 'hold', cwd: first, input: 'MOOS_FIXTURE_HOLD', signal: holder.signal });
  const holding = collect(hold.events());
  const pid = await waitFor(() => readFile(join(first, 'fixture-hold.pid'), 'utf8').then(Number).catch(() => 0));
  const same = await tasks.open({ sessionId: 'same', cwd: alias, input: 'MOOS_FIXTURE_WRITE same', signal });
  const other = await tasks.open({ sessionId: 'other', cwd: second, input: 'MOOS_FIXTURE_WRITE other', signal });
  assert.equal((await collect(other.events())).at(-1).payload.status, 'succeeded');
  assert.equal(await readFile(join(second, 'result.txt'), 'utf8'), 'other\n');
  assert.equal(store.listTasks().find(task => task.message.endsWith(' same')).status, 'queued');
  process.kill(pid, 0);
  holder.abort();
  assert.equal((await holding).at(-1).payload.status, 'cancelled');
  await waitFor(() => {
    try { process.kill(pid, 0); return false; }
    catch (error) { assert.equal(error.code, 'ESRCH'); return true; }
  });
  assert.equal((await collect(same.events())).at(-1).payload.status, 'succeeded');
  assert.equal(await readFile(join(first, 'result.txt'), 'utf8'), 'same\n');
  const conversation = store.getSetting('dsh-session:same');

  await tasks.close();
  store = new Store({ dbPath });
  tasks = makeTasks();
  await assert.rejects(tasks.open({ sessionId: 'same', cwd: second, input: 'MOOS_FIXTURE_TOOLS', signal }));
  const adapter = createPiAdapter({ tasks, getSession: () => ({ header: { cwd: first } }), getTurnStart: () => 21 });
  const request = input => ({ sessionId: 'same', signal, messages: [
    { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: input }] },
    { role: 'user', source: { kind: 'runtime-context' }, content: [{ type: 'text', text: 'ignored' }] },
  ] });
  const failure = await collect(adapter.stream(request('MOOS_FIXTURE_AUTH_FAIL')));
  assert.equal(failure.at(-1).reason.kind, 'error');
  assert.equal(failure.at(-1).reason.failure.code, 'AUTHENTICATION');
  assert.doesNotMatch(JSON.stringify(failure), /SECRET/);
  const limitedRequest = request('MOOS_FIXTURE_RATE_LIMIT');
  const limited = await collect(adapter.stream(limitedRequest));
  assert.equal(limited.at(-1).reason.failure.code, 'RATE_LIMIT');
  limitedRequest.messages.push({ role: 'user', source: { kind: 'retry' }, content: [] });
  const retried = await collect(adapter.stream(limitedRequest));
  assert.equal(retried.at(-1).reason.failure.code, 'RATE_LIMIT');
  const attempts = store.listTasks().filter(task => task.message === 'MOOS_FIXTURE_RATE_LIMIT');
  assert.equal(attempts.length, 2);
  assert.ok(attempts.every(task => task.conversationId === conversation && task.status === 'failed'));
  const continued = await collect(adapter.stream(request('MOOS_FIXTURE_WRITE continued')));
  assert.equal(continued.at(-1).reason.kind, 'stop');
  assert.ok(continued.some(event => event.type === 'text-delta' && event.text.includes('完成 continued')));
  assert.ok(continued.every(event => !event.text?.includes('PI 工具')));
  assert.equal(store.getSetting('dsh-session:same'), conversation);
  assert.equal(store.getSetting('dsh-turn:same:21'), store.listTasks().find(task => task.message.endsWith(' continued')).id);
  assert.equal(await readFile(join(first, 'result.txt'), 'utf8'), 'continued\n');
});

test('Electron retry resumes PI after a tool and accepts only the latest eligible task in that session', async t => {
  const data = await realpath(await mkdtemp(join(tmpdir(), 'moos-electron-retry-')));
  const dbPath = join(data, 'moos.sqlite');
  const requests = [];
  const fixture = await startFixture({ desktopPolicy: true, onModelRequest: request => requests.push(request) });
  let store = new Store({ dbPath });
  let tasks;
  t.after(async () => {
    await tasks?.close();
    await fixture.close();
    await rm(data, { recursive: true, force: true });
  });
  let seq = 0;
  const start = () => {
    tasks = createPiTasks({ store, Scheduler, run: options => runPiSdk({
      ...options, dataDir: join(data, 'pi'),
      provider: { id: 'moos-pi', name: 'Fixture', api: 'openai-completions', baseUrl: fixture.baseUrl,
        model: 'moos-fixture', contextWindow: 128000, maxTokens: 8192 }, apiKey: fixture.apiKey,
    }) });
    return createPiAdapter({ tasks, getSession: () => ({ header: { cwd: data } }), getTurnStart: () => ++seq });
  };
  let adapter = start();
  const send = (sessionId, text, retryOf) => collect(adapter.stream({ sessionId, messages: [{ role: 'user',
    source: { kind: 'user', rpcId: retryOf ? `moos-pi-retry:${retryOf}:${randomUUID()}` : randomUUID() },
    content: [{ type: 'text', text }],
  }] }));
  const original = 'MOOS_FIXTURE_RETRY';
  assert.equal((await send('retry', original)).at(-1).reason.failure.code, 'NETWORK');
  const previous = store.listTasks()[0];
  assert.equal(previous.status, 'failed');
  assert.equal(await readFile(join(data, 'retry-count.txt'), 'utf8'), 'once\n');
  await tasks.close();
  store = new Store({ dbPath });
  adapter = start();
  assert.equal((await send('foreign', '继续上次 PI 任务', previous.id)).at(-1).reason.kind, 'error');
  assert.equal(store.listTasks().length, 1);
  const results = await Promise.all([
    send('retry', '继续上次 PI 任务', previous.id),
    send('retry', '继续上次 PI 任务', previous.id),
  ]);
  assert.deepEqual(results.map(result => result.at(-1).reason.kind).sort(), ['error', 'stop']);
  const [resumed, failed] = store.listTasks();
  assert.equal(resumed.conversationId, previous.conversationId);
  assert.equal(resumed.status, 'succeeded');
  assert.equal(failed.status, 'failed');
  assert.equal(store.getSetting('dsh-turn:retry:1'), failed.id);
  assert.ok(store.listEvents(resumed.id).some(event => event.type === 'task_retry' && event.payload.previousTaskId === previous.id));
  assert.equal(await readFile(join(data, 'retry-count.txt'), 'utf8'), 'once\n');
  assert.equal(await readFile(join(data, 'retry-result.txt'), 'utf8'), 'resumed\n');
  assert.equal(requests.length, 4);
  assert.equal(JSON.stringify(requests[2].messages).match(/MOOS_FIXTURE_RETRY/g).length, 1);
  assert.ok(requests[2].messages.some(message => message.role === 'tool'));
  assert.equal((await send('retry', '继续上次 PI 任务', resumed.id)).at(-1).reason.kind, 'error');
  assert.equal(store.listTasks().length, 2);

  const cold = store.createConversation(previous.projectId);
  store.setSetting('dsh-session:interrupted', cold.id);
  const unfinished = store.createTask({ conversationId: cold.id, message: 'MOOS_FIXTURE_WRITE interrupted' });
  assert.equal(store.interruptUnfinished(), 1);
  assert.equal(store.getTask(unfinished.id).status, 'interrupted');
  assert.equal(requests.length, 4);
  assert.equal((await send('interrupted', '继续上次 PI 任务', unfinished.id)).at(-1).reason.kind, 'stop');
  assert.equal(await readFile(join(data, 'result.txt'), 'utf8'), 'interrupted\n');
  assert.match(JSON.stringify(requests[4].messages), /原始任务.*MOOS_FIXTURE_WRITE interrupted/);
});

test('DSH forks give PI exactly the selected history, with text fallback for older turns', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'moos-electron-fork-')));
  const project = join(root, 'project');
  await mkdir(project);
  const store = new Store({ dbPath: join(root, 'test.sqlite') });
  const requests = [];
  const fixture = await startFixture({ onModelRequest: request => requests.push(request) });
  const tasks = createPiTasks({ store, Scheduler, run: options => runPiSdk({
    ...options, dataDir: join(root, 'sessions'),
    provider: { id: 'moos-pi', name: 'Fixture', api: 'openai-completions', baseUrl: fixture.baseUrl,
      model: 'moos-fixture', contextWindow: 128000, maxTokens: 8192 }, apiKey: fixture.apiKey,
  }) });
  t.after(async () => {
    await tasks.close();
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  });
  const user = (id, text) => ({ id, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] });
  function settledTurn(message, text) {
    return [{ type: 'turn/start', data: {} }, { type: 'user/message', data: message },
      { type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } },
      { type: 'turn/end', data: { reason: { kind: 'completed' } } }].map((event, index) => ({ ...event, time: index + 1 }));
  }
  const first = user('message-first', 'MOOS_FIXTURE_WRITE before');
  const later = user('message-later', 'MOOS_FIXTURE_WRITE after');
  const fullPrefix = [...settledTurn(first, 'Visible first reply'), ...settledTurn(later, 'Visible later reply')];
  const legacy = settledTurn(user('message-old', 'Old prompt'), 'Old visible reply');
  const adapter = createPiAdapter({ tasks, getSession(id) {
    const events = id === 'legacy' ? legacy : fullPrefix;
    return { header: { cwd: project, isSeeded: id !== 'parent' },
      inheritedEventCount: 4, snapshotEvents: (from, to) => events.slice(from, to) };
  } });
  async function submit(sessionId, message) {
    const start = requests.length;
    const result = await collect(adapter.stream({ sessionId, messages: [message] }));
    assert.equal(result.at(-1).reason.kind, 'stop');
    return requests[start].messages;
  }
  await submit('parent', first);
  await submit('parent', later);
  const branched = await submit('child', user('message-child', 'MOOS_FIXTURE_WRITE child'));
  const branchText = JSON.stringify(branched);
  assert.match(branchText, /MOOS_FIXTURE_WRITE before/);
  assert.ok(branched.some(message => message.role === 'tool'));
  assert.doesNotMatch(branchText, /MOOS_FIXTURE_WRITE after|Visible first reply/);
  const parent = JSON.stringify(await submit('parent', user('message-parent', 'MOOS_FIXTURE_WRITE parent')));
  assert.match(parent, /MOOS_FIXTURE_WRITE after/);
  assert.doesNotMatch(parent, /MOOS_FIXTURE_WRITE child/);
  const child = JSON.stringify(await submit('child', user('message-child-next', 'MOOS_FIXTURE_WRITE childnext')));
  assert.equal(child.match(/MOOS_FIXTURE_WRITE before/g).length, 1);
  assert.match(child, /MOOS_FIXTURE_WRITE child"/);
  const restored = await submit('legacy', user('message-legacy', 'MOOS_FIXTURE_WRITE legacy'));
  assert.ok(restored.some(message => message.role === 'user' && JSON.stringify(message.content).includes('Old prompt')));
  assert.ok(restored.some(message => message.role === 'assistant' && JSON.stringify(message.content).includes('Old visible reply')));
  assert.ok(restored.every(message => message.role !== 'tool'));
});
