import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
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
  const adapter = createPiAdapter({ tasks, getSession: () => ({ header: { cwd: first } }) });
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
  assert.equal(store.getSetting('dsh-session:same'), conversation);
  assert.equal(await readFile(join(first, 'result.txt'), 'utf8'), 'continued\n');
});
