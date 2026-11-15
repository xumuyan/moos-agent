import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { validateTeamPlan, runPiTeam, TEAM_LIMITS } from './team-runtime.mjs';
import { Store } from '../../services/agent/store.mjs';
import { Scheduler } from '../../services/agent/scheduler.mjs';

const plan = { tasks: [
  { id: 'build', role: 'implementer', goal: 'Write answer.txt containing 42', dependsOn: [] },
  { id: 'check', role: 'verifier', goal: 'Read answer.txt and verify 42', dependsOn: ['build'] },
] };
const base = () => ({ task: { id: 'task-a', text: 'produce 42', timeoutMs: 600000 }, conversation: { id: 'chat-a' } });
const submit = async (options, name, args) => {
  const tool = options.sessionPolicy.customTools?.find(tool => tool.name === name);
  assert.ok(tool, name);
  return tool.execute('call', args, options.signal);
};
const evidence = options => options.emit('tool_end', { toolCallId: 'read', toolName: 'read', isError: false, result: {} });
function fakeRun(trace = [], { failed = false, noEvidence = false } = {}) {
  return async options => {
    trace.push(options.conversation.id);
    options.sessionPolicy.beforeRequest();
    if (options.task.text.includes('你是队长。')) await submit(options, 'team_plan', plan);
    else if (options.sessionPolicy.customTools?.some(tool => tool.name === 'team_verdict')) {
      if (!noEvidence) evidence(options);
      await submit(options, 'team_verdict', { passed: !failed, summary: failed ? 'wrong' : 'checked actual file' });
    }
    return { text: 'real member result' };
  };
}

test('team plan is a bounded DAG and final verifier covers all tasks', () => {
  assert.deepEqual(validateTeamPlan(plan).map(node => node.id), ['build', 'check']);
  for (const edit of [
    p => { p.tasks[0].dependsOn = ['check']; },
    p => { p.tasks[1].dependsOn = ['missing']; },
    p => { p.tasks[1].dependsOn = []; },
    p => { p.tasks[1].id = 'build'; },
    p => { p.tasks[1].role = 'captain'; },
    p => { p.tasks[0].goal = ''; },
    p => { p.tasks.push(...Array.from({ length: 6 }, () => p.tasks[0])); },
  ]) {
    const p = structuredClone(plan); edit(p);
    assert.throws(() => validateTeamPlan(p));
  }
});

test('independent bounded PI turns run sequentially and only final summary is emitted', async () => {
  const trace = [], events = [];
  const result = await runPiTeam({ ...base(), emit: (type, payload) => events.push({ type, payload }) }, fakeRun(trace));
  assert.equal(result.text, 'real member result');
  assert.equal(trace.length, 4);
  assert.equal(new Set(trace).size, 3);
  assert.equal(trace[0], trace[3], 'captain resumes its own independent history');
  assert.equal(events.filter(event => event.type === 'text_delta').length, 1);
  assert.equal(events.filter(event => event.payload.phase === 'succeeded').length, 1);
  assert.match(events.find(event => event.type === 'tool_end').payload.toolCallId, /^verifier:/);
});

test('failed or unsubstantiated verifier never becomes success and cannot release downstream', async () => {
  for (const settings of [{ failed: true }, { noEvidence: true }]) {
    const trace = [], events = [];
    await assert.rejects(runPiTeam({ ...base(), emit: (type, payload) => events.push({ type, payload }) }, fakeRun(trace, settings)));
    assert.equal(trace.length, 3, 'summary not started after failed verification');
    assert.ok(!events.some(event => event.payload.phase === 'succeeded'));
  }
});

test('cancel drains active member, suppresses late events, and starts no downstream', async () => {
  const controller = new AbortController(), events = [], trace = [];
  const active = Promise.withResolvers(), drained = Promise.withResolvers();
  const run = async options => {
    trace.push(options.conversation.id);
    if (trace.length === 1) { await submit(options, 'team_plan', plan); return { text: 'plan' }; }
    active.resolve();
    await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }));
    options.emit('text_delta', { delta: 'late' });
    options.emit('tool_end', { toolName: 'write' });
    await drained.promise;
    return { text: 'late' };
  };
  let settled = false;
  const execution = runPiTeam({ ...base(), signal: controller.signal, emit: (type, payload) => events.push({ type, payload }) }, run)
    .finally(() => { settled = true; });
  await active.promise;
  controller.abort();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, 'must await real cleanup before releasing parent lease');
  drained.resolve();
  await assert.rejects(execution, error => error.code === 'cancelled');
  assert.equal(trace.length, 2);
  assert.ok(!events.some(event => ['text_delta', 'tool_end'].includes(event.type)));
});

test('model requests and reported token use are bounded, never emit successful delivery', async () => {
  for (const kind of ['requests', 'tokens']) {
    const events = [];
    await assert.rejects(runPiTeam({ ...base(), emit: (type, payload) => events.push({ type, payload }) }, async options => {
      if (kind === 'requests') for (let i = 0; i <= TEAM_LIMITS.requests; i++) options.sessionPolicy.beforeRequest();
      else options.emit('usage', { totalTokens: TEAM_LIMITS.tokens + 1 });
      return { text: '' };
    }), error => error.code === 'tool_error');
    assert.ok(!events.some(event => event.payload.phase === 'succeeded'));
  }
});

// Actual PI SDK -> local model -> write/read/customTools -> independent session files.
// This is not an external model or GUI/production acceptance.
test('real SDK team creates an artifact, independently reads it and resumes captain for summary', { timeout: 30000 }, async t => {
  const home = await mkdtemp(join(tmpdir(), 'muma-team-sdk-'));
  const cwd = join(home, 'project'); await mkdir(cwd);
  const events = [], requests = [], errors = [];
  const server = createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      requests.push(body);
      const user = body.messages.filter(item => item.role === 'user').at(-1);
      const prompt = typeof user.content === 'string' ? user.content : user.content.map(part => part.text ?? '').join('');
      const toolNames = body.tools?.map(item => item.function.name) ?? [];
      const summary = prompt.includes('只根据已有工具/成员证据');
      const latestTool = body.messages.at(-1).role === 'tool' ? body.messages.at(-1) : undefined;
      let name, args, content;
      if (summary) {
        assert.deepEqual(toolNames, [], 'summary must have no write/bash/other side effect tools');
        content = '已交付 answer.txt，独立读取验证内容为42。';
      } else if (toolNames.includes('team_plan')) {
        assert.deepEqual(toolNames.slice().sort(), ['ls', 'read', 'team_plan']);
        if (latestTool) content = '计划已提交';
        else { name = 'team_plan'; args = plan; }
      } else if (toolNames.includes('team_verdict')) {
        if (!latestTool) { name = 'read'; args = { path: 'answer.txt' }; }
        else if (latestTool.name === 'read' || latestTool.content.includes('42')) {
          assert.ok(latestTool.content.includes('42'));
          name = 'team_verdict'; args = { passed: true, summary: '读取产物为42' };
        } else content = '验证通过';
      } else {
        if (latestTool) content = '已写入产物';
        else { name = 'write'; args = { path: 'answer.txt', content: '42\n' }; }
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const delta = name ? { tool_calls: [{ index: 0, id: `call-${requests.length}`, type: 'function',
        function: { name, arguments: JSON.stringify(args) } }] } : { content };
      for (const [data, finish] of [[delta, null], [{}, name ? 'tool_calls' : 'stop']]) {
        res.write('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: data, finish_reason: finish }] }) + '\n\n');
      }
      res.end('data: [DONE]\n\n');
    } catch (error) { errors.push(error); res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); server.close(); await rm(home, { recursive: true, force: true }); });
  const result = await runPiTeam({ ...base(), project: { path: cwd }, dataDir: join(home, 'sessions'), imageGen: null,
    apiKey: 'synthetic-local-only', permissions: { getMode: () => 'workspace-write' },
    emit: (type, payload) => events.push({ type, payload }),
    provider: { id: 'fixture', name: 'Local team fixture', model: 'fixture-model', api: 'openai-completions',
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`, contextWindow: 128000, maxTokens: 2048 } });
  assert.deepEqual(errors, []);
  assert.equal(await readFile(join(cwd, 'answer.txt'), 'utf8'), '42\n');
  assert.match(result.text, /独立读取验证/);
  const dirs = await readdir(join(home, 'sessions'));
  assert.equal(dirs.filter(dir => dir.startsWith('team-')).length, 3);
  for (const dir of dirs) {
    const files = await readdir(join(home, 'sessions', dir));
    assert.equal(files.filter(name => name.endsWith('.jsonl')).length, 1);
  }
  assert.ok(events.some(event => event.type === 'tool_end' && event.payload.member === 'implementer' && event.payload.toolName === 'write'));
  assert.ok(events.some(event => event.type === 'tool_end' && event.payload.member === 'verifier' && event.payload.toolName === 'read'));
});

test('parent Scheduler team lease serializes same-directory teams without child self-deadlock and permits other projects', { timeout: 10000 }, async t => {
  const home = await mkdtemp(join(tmpdir(), 'muma-team-lease-'));
  await mkdir(join(home, 'a')); await mkdir(join(home, 'b'));
  const store = new Store({ dbPath: join(home, 'db.sqlite') });
  const a = await store.addProject(join(home, 'a')), b = await store.addProject(join(home, 'b'));
  const ca = store.createConversation(a.id), cb = store.createConversation(b.id);
  const active = new Map(), counts = new Map(); let overlapped = false;
  const scheduler = new Scheduler({ store, run: options => runPiTeam({ ...options, task: { ...options.task, text: options.task.message } }, async child => {
    const path = options.project.path;
    assert.equal(active.get(path) ?? 0, 0, 'no same-directory child overlap');
    active.set(path, 1); counts.set(path, (counts.get(path) ?? 0) + 1);
    if (active.size === 2 && [...active.values()].every(Boolean)) overlapped = true;
    await new Promise(resolve => setTimeout(resolve, 5));
    const result = await fakeRun()(child);
    active.set(path, 0);
    return result;
  }) });
  t.after(async () => { await scheduler.shutdown(); store.close(); await rm(home, { recursive: true, force: true }); });
  const submitted = [ca, ca, cb].map(conversation => scheduler.submit({ conversationId: conversation.id, message: 'produce 42' }));
  while (submitted.some(task => ['queued', 'running'].includes(store.getTask(task.id).status))) await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(submitted.map(task => store.getTask(task.id).status), ['succeeded', 'succeeded', 'succeeded']);
  assert.equal(counts.get(a.path), 8);
  assert.equal(counts.get(b.path), 4);
  assert.equal(overlapped, true);
});

test('settled attempt coordination tools cannot accept late plans', async () => {
  let oldTool;
  await runPiTeam(base(), async options => {
    const found = options.sessionPolicy.customTools?.find(tool => tool.name === 'team_plan');
    if (found) oldTool = found;
    return fakeRun()(options);
  });
  await assert.rejects(async () => oldTool.execute('late', plan), /Stale team attempt/);
});

test('team deadline cancels the current member and awaits cleanup before returning timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const started = Promise.withResolvers(), drained = Promise.withResolvers();
  const execution = runPiTeam(base(), async options => {
    started.resolve();
    await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }));
    await drained.promise;
    return { text: 'too late' };
  });
  await started.promise;
  t.mock.timers.tick(600001);
  drained.resolve();
  await assert.rejects(execution, error => error.code === 'timeout');
});

test('explicit team retry starts fresh owned sessions with existing-work inspection guidance, not automatic replay', async () => {
  const prompts = [];
  await runPiTeam({ ...base(), retry: true }, async options => {
    prompts.push(options);
    return fakeRun()(options);
  });
  assert.match(prompts[0].task.text, /用户显式重试.*前次可能已有副作用/);
  assert.match(prompts[0].task.text, /禁止盲目重复安装、提交、发送或部署/);
  assert.ok(prompts.every(item => item.retry === false && item.fork === undefined));
  // This is guidance plus fresh task-scoped ownership, not transactional
  // exactly-once side effects or a resumable-node recovery protocol.
});
