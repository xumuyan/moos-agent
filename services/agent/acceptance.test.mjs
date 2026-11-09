import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const loadFixture = () => import('./fixture.mjs');
test('PI SDK HTTP idle timeout follows the selected task deadline instead of five minutes', async () => {
  const { sdkSettings } = await import('../../packages/pi-runtime/sdk-runtime.mjs');
  assert.equal(sdkSettings(7200000).getHttpIdleTimeoutMs(), 7200000);
  assert.equal(sdkSettings(86400000).getHttpIdleTimeoutMs(), 86400000);
  assert.equal(sdkSettings(7200000).getProviderRetrySettings().timeoutMs, 7200000);
  assert.equal(sdkSettings(86400000).getProviderRetrySettings().timeoutMs, 86400000);
});
async function completion(f, messages, key = f.apiKey) {
  const response = await fetch(`${f.baseUrl}/chat/completions`, {
    method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'moos-fixture', stream: true, messages }),
  });
  const text = await response.text();
  const chunks = text.split('\n').filter(line => line.startsWith('data: ') && line !== 'data: [DONE]')
    .map(line => JSON.parse(line.slice(6)));
  const deltas = chunks.flatMap(chunk => chunk.choices.map(choice => choice.delta));
  return { status: response.status, text, chunks, call: deltas.flatMap(delta => delta.tool_calls ?? [])[0],
    content: deltas.map(delta => delta.content ?? '').join('') };
}
function answered(messages, call, content = 'OK') {
  return [...messages, { role: 'assistant', content: null, tool_calls: [{ ...call, index: undefined }] },
    { role: 'tool', tool_call_id: call.id, content }];
}

test('fixture authenticates and follows current-turn tool results without looping', async t => {
  const { startFixture } = await loadFixture();
  const f = await startFixture(); t.after(() => f.close());
  let messages = [{ role: 'user', content: 'MOOS_FIXTURE_WRITE FIRST_1' }];
  assert.equal((await completion(f, messages, 'wrong')).status, 401);
  const write = await completion(f, messages);
  assert.equal(write.status, 200);
  assert.equal(write.call.function.name, 'write');
  assert.deepEqual(JSON.parse(write.call.function.arguments), { path: 'result.txt', content: 'FIRST_1\n' });
  assert.match(write.text, /data: \[DONE\]/);
  assert.equal(write.chunks.at(-1).choices[0].finish_reason, 'tool_calls');
  const pending = await completion(f, [...messages, { role: 'assistant', tool_calls: [write.call] }]);
  assert.equal(pending.status, 409);
  messages = answered(messages, write.call);
  const bash = await completion(f, messages);
  assert.equal(bash.call.function.name, 'bash');
  assert.equal(JSON.parse(bash.call.function.arguments).timeout, 5);
  messages = answered(messages, bash.call, 'verified FIRST_1');
  assert.equal((await completion(f, messages)).content, '完成 FIRST_1');
  messages.push({ role: 'assistant', content: '完成 FIRST_1' }, { role: 'user', content: [{ type: 'text', text: 'MOOS_FIXTURE_WRITE SECOND_2' }] });
  const second = await completion(f, messages);
  assert.equal(second.call.function.name, 'write');
  assert.equal(JSON.parse(second.call.function.arguments).content, 'SECOND_2\n');
  for (const marker of ['bad-name', '../bad', 'bad;touch', '']) {
    assert.equal((await completion(f, [{ role: 'user', content: `MOOS_FIXTURE_WRITE ${marker}` }])).status, 400);
  }
  const hold = await completion(f, [{ role: 'user', content: 'MOOS_FIXTURE_HOLD' }]);
  assert.equal(hold.call.function.name, 'bash');
  const args = JSON.parse(hold.call.function.arguments);
  assert.equal(args.timeout, 30);
  assert.match(args.command, /fixture-hold\.pid/);
  assert.match(args.command, /process\.pid/);
  assert.match(args.command, /setTimeout/);
  assert.equal((await completion(f, answered([{ role: 'user', content: 'MOOS_FIXTURE_HOLD' }], hold.call))).content, '完成 HOLD');
});

async function waitFor(check, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(25);
  }
  assert.fail(`Timed out waiting for ${label}`);
}
async function files(path) {
  const result = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) result.push(...await files(child));
    else result.push(child);
  }
  return result;
}
async function terminal(controller, task, expected) {
  const state = await waitFor(async () => {
    const state = await controller.request('snapshot');
    const current = state.tasks.find(item => item.id === task.id);
    return ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(current?.status) && state;
  }, `task ${task.id}`);
  assert.equal(state.tasks.find(item => item.id === task.id).status, expected, JSON.stringify(state.events.filter(e => e.taskId === task.id)));
  return state;
}
async function setup(t, api = 'openai-completions', fixtureOptions, provider = {}) {
  // Deliberately fail, rather than skip, when the integration entry point is absent.
  const [{ startFixture }, { createController }, { runPiSdk: runPi }] = await Promise.all([
    loadFixture(), import('./controller.mjs'), import('../../packages/pi-runtime/sdk-runtime.mjs'),
  ]);
  const root = await mkdtemp(join(tmpdir(), 'moos-acceptance-'));
  let controller; let fixture;
  const requests = [];
  t.after(async () => { try { await controller?.close(); } finally { await fixture?.close(); await rm(root, { recursive: true, force: true }); } });
  fixture = await startFixture(fixtureOptions
    ? { ...fixtureOptions, onModelRequest: input => requests.push(input) } : undefined);
  const dataDir = join(root, 'data');
  controller = await createController({ dataDir, run: runPi });
  await controller.request('save_provider', { provider: { id: 'fixture', name: 'Local deterministic fixture',
    baseUrl: fixture.baseUrl, model: 'moos-fixture', api, ...provider } });
  const projects = []; const conversations = [];
  for (const name of ['alpha', 'beta']) {
    const path = join(root, name); await mkdir(path);
    const project = await controller.request('add_project', { path }); projects.push(project);
    conversations.push(await controller.request('create_conversation', { projectId: project.id }));
  }
  return { root, dataDir, fixture, requests, projects, conversations, get controller() { return controller; },
    submit: (index, message) => controller.request('submit', { conversationId: conversations[index].id, message, providerId: 'fixture', apiKey: fixture.apiKey }),
    restart: async () => { await controller.close(); controller = await createController({ dataDir, run: runPi }); } };
}

test('PI SDK streams the configured responses protocol without a CLI child', { timeout: 30000 }, async t => {
  const f = await setup(t, 'openai-responses');
  const task = await f.submit(0, 'MOOS_FIXTURE_RESPONSES');
  const state = await terminal(f.controller, task, 'succeeded');
  assert(state.messages.some(message => message.taskId === task.id && message.content === 'Responses SDK ready'));
  assert(state.events.some(event => event.taskId === task.id && event.type === 'usage'));
  const usage = await f.controller.request('get_usage', { range: 'all' });
  assert.equal(usage.recordCount, 1);
  assert.equal(usage.cacheReadTokens, null);
  assert.equal(usage.cacheHitRate, null);
  assert.equal(usage.costUsd, 0.0002);
});

test('GLM Responses thinking levels reach the wire as documented reasoning efforts', { timeout: 90000 }, async t => {
  for (const [level, expected] of [['off', 'none'], ['minimal', 'minimal'], ['low', 'low'], ['xhigh', 'xhigh']]) {
    const f = await setup(t, 'openai-responses', {}, { service: 'glm', thinkingLevel: level });
    const task = await f.submit(0, 'MOOS_FIXTURE_RESPONSES');
    const state = await terminal(f.controller, task, 'succeeded');
    assert(state.messages.some(message => message.taskId === task.id && message.content === 'Responses SDK ready'), level);
    const streamed = f.requests.filter(item => item.stream === true);
    assert(streamed.length >= 1, `no streamed model request for thinkingLevel ${level}`);
    assert.equal(streamed.at(-1).reasoning?.effort, expected, `thinkingLevel ${level}`);
  }
});

test('two-hour policy carries a long fixture task past an accelerated old boundary', { timeout: 30000 }, async t => {
  const f = await setup(t, 'openai-completions', { longDelayMs: 100 });
  const task = await f.submit(0, 'MOOS_FIXTURE_LONG');
  const state = await terminal(f.controller, task, 'succeeded');
  const saved = state.tasks.find(item => item.id === task.id);
  assert.equal(saved.timeoutMs, 7200000);
  assert(state.messages.some(message => message.taskId === task.id && message.content === '完成 LONG'));
});

test('provider failures persist a safe explainable code without upstream text', { timeout: 30000 }, async t => {
  const f = await setup(t);
  const task = await f.submit(0, 'MOOS_FIXTURE_AUTH_FAIL');
  const state = await terminal(f.controller, task, 'failed');
  const saved = state.tasks.find(item => item.id === task.id);
  assert.equal(saved.errorCode, 'auth');
  assert.equal(saved.error, '模型服务认证失败，请检查 API 密钥。');
  assert(!JSON.stringify(state).includes('fixture upstream SECRET detail'));
  assert.equal((await f.controller.request('get_usage', { range: 'all' })).recordCount, 0);
});

test('stopping a quiet model request cancels the stream and closes its proxy promptly', { timeout: 30000 }, async t => {
  const f = await setup(t, 'openai-completions', { longDelayMs: 5000 });
  const task = await f.submit(0, 'MOOS_FIXTURE_LONG');
  await waitFor(async () => (await f.controller.request('snapshot')).tasks.find(item => item.id === task.id)?.status === 'running', 'quiet task start');
  const started = Date.now();
  await f.controller.request('cancel', { taskId: task.id });
  await terminal(f.controller, task, 'cancelled');
  assert(Date.now() - started < 2000);
  const modelConfig = JSON.parse(await readFile(join(f.dataDir, f.conversations[0].id, 'agent', 'models.json'), 'utf8'));
  await assert.rejects(fetch(modelConfig.providers.fixture.baseUrl + '/chat/completions'));
});

test('real PI isolates two projects, attributes tool results and restores history across restart', { timeout: 60000 }, async t => {
  const f = await setup(t);
  const alias = join(f.root, 'alpha-alias'); await symlink(f.projects[0].path, alias, 'dir');
  assert.equal((await f.controller.request('add_project', { path: alias })).id, f.projects[0].id);
  const tasks = await Promise.all([f.submit(0, 'MOOS_FIXTURE_WRITE ALPHA_1'), f.submit(1, 'MOOS_FIXTURE_WRITE BETA_2')]);
  await Promise.all(tasks.map(task => terminal(f.controller, task, 'succeeded')));
  const before = await f.controller.request('snapshot');
  assert.equal(before.projects.length, 2);
  for (const [i, marker] of ['ALPHA_1', 'BETA_2'].entries()) {
    assert.equal(await readFile(join(f.projects[i].path, 'result.txt'), 'utf8'), `${marker}\n`);
    const events = before.events.filter(event => event.taskId === tasks[i].id);
    assert(events.length > 0);
    assert(events.every(event => event.projectId === f.projects[i].id && event.conversationId === f.conversations[i].id));
    assert.deepEqual(events.filter(e => e.type === 'tool_start').map(e => e.payload.toolName), ['write', 'bash']);
    const bash = events.find(e => e.type === 'tool_end' && e.payload.toolName === 'bash');
    assert(bash, 'bash completion event must be persisted');
    assert.match(JSON.stringify(bash.payload), new RegExp(`verified ${marker}`));
    assert(before.messages.some(m => m.taskId === tasks[i].id && m.role === 'assistant' && m.content === `完成 ${marker}`));
  }
  assert(!JSON.stringify(before).includes(f.fixture.apiKey));
  const usage = await f.controller.request('get_usage', { range: 'all' });
  assert.equal(usage.recordCount, 6);
  assert.equal(usage.cacheReadTokens, 24);
  assert.equal(usage.cacheHitRate, 24 / (96 + 24));
  assert.equal(usage.costUsd, 0.00072);
  await f.restart();
  const restored = await f.controller.request('snapshot');
  assert.equal((await f.controller.request('get_usage', { range: 'all' })).recordCount, 6);
  for (const key of ['projects', 'conversations', 'messages', 'tasks', 'events', 'providers']) assert.deepEqual(restored[key], before[key]);
  // Reuse the persisted PI session: previous turn tool results must not skip this turn's write.
  await terminal(f.controller, await f.submit(0, 'MOOS_FIXTURE_WRITE AFTER_RESTART'), 'succeeded');
  assert.equal(await readFile(join(f.projects[0].path, 'result.txt'), 'utf8'), 'AFTER_RESTART\n');
  for (const path of await files(f.dataDir)) assert(!String(await readFile(path)).includes(f.fixture.apiKey), path);
});

test('PI SDK emits start and end events for every allowed development tool', { timeout: 30000 }, async t => {
  const f = await setup(t);
  const task = await f.submit(0, 'MOOS_FIXTURE_TOOLS');
  const state = await terminal(f.controller, task, 'succeeded');
  const events = state.events.filter(event => event.taskId === task.id);
  const expected = ['write', 'read', 'edit', 'grep', 'find', 'ls', 'bash'];
  assert.deepEqual(events.filter(event => event.type === 'tool_start').map(event => event.payload.toolName), expected);
  assert.deepEqual(events.filter(event => event.type === 'tool_end').map(event => event.payload.toolName), expected);
  assert.equal(await readFile(join(f.projects[0].path, 'all-tools.txt'), 'utf8'), 'after edit\n');
  assert(events.some(event => event.type === 'tool_update'));
});

test('cancelling active bash and a same-project queued task leaves the other project running and no child', { timeout: 60000 }, async t => {
  const f = await setup(t);
  const hold = await f.submit(0, 'MOOS_FIXTURE_HOLD');
  const pid = await waitFor(async () => {
    try { return Number(await readFile(join(f.projects[0].path, 'fixture-hold.pid'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const state = await f.controller.request('snapshot');
    const current = state.tasks.find(task => task.id === hold.id);
    assert.equal(current.status, 'running', `Hold task ended before child startup: ${JSON.stringify(current)}`);
  }, 'hold child pid');
  assert(Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid);
  const queued = await f.submit(0, 'MOOS_FIXTURE_WRITE MUST_NOT_RUN');
  assert.equal((await f.controller.request('snapshot')).tasks.find(task => task.id === queued.id).status, 'queued');
  const other = await f.submit(1, 'MOOS_FIXTURE_WRITE UNAFFECTED');
  await f.controller.request('cancel', { taskId: queued.id });
  await f.controller.request('cancel', { taskId: hold.id });
  await terminal(f.controller, hold, 'cancelled');
  await terminal(f.controller, queued, 'cancelled');
  const state = await terminal(f.controller, other, 'succeeded');
  await waitFor(() => {
    try { process.kill(pid, 0); return false; }
    catch (error) { if (error.code === 'ESRCH') return true; throw error; }
  }, 'cancelled bash child exit', 5000);
  assert.equal(await readFile(join(f.projects[1].path, 'result.txt'), 'utf8'), 'UNAFFECTED\n');
  await assert.rejects(readFile(join(f.projects[0].path, 'result.txt')), { code: 'ENOENT' });
  assert(!state.events.some(e => e.taskId === queued.id && e.type === 'tool_start'));
  assert(!state.messages.some(m => [hold.id, queued.id].includes(m.taskId) && m.role === 'assistant'));
  const modelConfig = JSON.parse(await readFile(join(f.dataDir, f.conversations[0].id, 'agent', 'models.json'), 'utf8'));
  await assert.rejects(fetch(modelConfig.providers.fixture.baseUrl + '/chat/completions'));
});
