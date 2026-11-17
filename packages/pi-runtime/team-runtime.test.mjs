import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { validateTeamPlan, runPiTeam, TEAM_LIMITS } from './team-runtime.mjs';
import { Store } from '../../services/agent/store.mjs';
import { Scheduler } from '../../services/agent/scheduler.mjs';
import { TaskFailure } from '../../services/agent/errors.mjs';

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
function fakeRun(trace = [], { failed = false, noEvidence = false, rejected = false, noVerdict = false } = {}) {
  return async options => {
    trace.push(options.conversation.id);
    options.sessionPolicy.beforeRequest();
    if (options.task.text.includes('你是队长。')) await submit(options, 'team_plan', plan);
    else if (options.sessionPolicy.customTools?.some(tool => tool.name === 'team_verdict')) {
      if (!noEvidence) evidence(options);
      if (!noVerdict) await submit(options, 'team_verdict', { passed: !failed && !rejected, summary: failed || rejected ? 'wrong' : 'checked actual file' });
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
  const activeNodes = events.filter(event => event.type === 'team_state' && event.payload.phase === 'running' && event.payload.nodeId);
  assert.deepEqual(activeNodes.map(event => [event.payload.nodeId, event.payload.member]), plan.tasks.map(node => [node.id, node.role]));
  assert.ok(activeNodes.every(event => /^[a-f0-9-]{36}$/.test(event.payload.attemptId)));
  for (const { payload } of activeNodes) for (const phase of ['done', 'completed']) assert.ok(events.some(event => event.payload.phase === phase
    && event.payload.nodeId === payload.nodeId && event.payload.attemptId === payload.attemptId));
});

  test('failed or unsubstantiated verifier never becomes success and cannot release downstream', async () => {
  for (const settings of [{ failed: true }, { noEvidence: true }]) {
    const trace = [], events = [];
    await assert.rejects(runPiTeam({ ...base(), emit: (type, payload) => events.push({ type, payload }) }, fakeRun(trace, settings)),
      error => settings.failed && settings.noEvidence !== true
        ? error.code === 'verification_rejected' : true);
    assert.equal(trace.length, 3, 'summary not started after failed verification');
    assert.ok(!events.some(event => event.payload.phase === 'succeeded'));
    if (settings.failed) {
      const started = events.find(event => event.payload.phase === 'running' && event.payload.nodeId === 'check').payload;
      const blocked = events.find(event => event.payload.phase === 'blocked').payload;
      assert.equal(blocked.attemptId, started.attemptId);
      assert.equal(blocked.nodeId, started.nodeId);
    }
  }
});

test('rejected verdict throws verification_rejected, missing verdict throws verification_incomplete', async () => {
  for (const [settings, expected] of [[{ rejected: true }, 'verification_rejected'], [{ noVerdict: true }, 'verification_incomplete']]) {
    const trace = [], events = [];
    await assert.rejects(runPiTeam({ ...base(), emit: (type, payload) => events.push({ type, payload }) }, fakeRun(trace, settings)),
      error => error.code === expected);
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
    options.emit('usage', { inputTokens: 10, outputTokens: 2, totalTokens: 12 });
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
  assert.ok(!events.some(event => ['text_delta', 'tool_end', 'usage'].includes(event.type)));
});

test('model requests and reported token use are bounded, never emit successful delivery', async () => {
  for (const kind of ['requests', 'tokens']) {
    const events = [];
    await assert.rejects(runPiTeam({ ...base(), teamBudget: { [kind]: 3 }, emit: (type, payload) => events.push({ type, payload }) }, async options => {
      if (kind === 'requests') for (let i = 0; i < 4; i++) options.sessionPolicy.beforeRequest();
      else options.emit('usage', { inputTokens: 3, outputTokens: 1 });
      return { text: '' };
    }), error => error.code === (kind === 'requests' ? 'team_request_budget' : 'team_budget'));
    const stopped = events.find(event => event.type === 'team_budget' && event.payload.phase === 'exceeded');
    assert.equal(stopped.payload.limits[kind], 3);
    assert.equal(stopped.payload.reason, kind === 'requests' ? 'team_request_budget' : 'team_budget');
    if (kind === 'requests') assert.equal(stopped.payload.requests, 3, 'fourth upstream request is prevented');
    assert.ok(!events.some(event => event.payload.phase === 'succeeded'));
  }
});

test('token budget counts only chargeable tokens, ignoring cacheRead replay', async () => {
  const events = [];
  const result = await runPiTeam({ ...base(), teamBudget: { tokens: 5000 }, emit: (type, payload) => events.push({ type, payload }) }, async options => {
    if (options.task.text.includes('你是队长。')) { await submit(options, 'team_plan', plan); }
    else if (options.task.text.includes('独立验证')) {
      evidence(options);
      await submit(options, 'team_verdict', { passed: true, summary: 'checked actual file' });
    }
    // 模拟生产 55e6423f 形态：单次 totalTokens ≈ 5 万（含 cacheRead），chargeable 很小。
    options.emit('usage', { inputTokens: 1000, outputTokens: 50, cacheReadTokens: 50000, totalTokens: 51050 });
    return { text: 'ok' };
  });
  assert.equal(result.text, 'ok');
  assert.ok(!events.some(event => event.payload.phase === 'failed'));
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
      res.write('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }) + '\n\n');
      res.end('data: [DONE]\n\n');
    } catch (error) { errors.push(error); res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); server.close(); await rm(home, { recursive: true, force: true }); });
  const result = await runPiTeam({ ...base(), project: { path: cwd }, dataDir: join(home, 'sessions'), imageGen: null,
    fork: { history: [{ role: 'user', text: 'APPROVED_PARENT_PLAN_BLUE', timestamp: 1 },
      { role: 'assistant', text: 'APPROVED_PARENT_REPLY_BLUE', timestamp: 2 }] },
    images: [{ type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR4nGP4z8DwnxLMMGrAqAGjBgwXAwAwxP4QHCfkAAAAAABJRU5ErkJggg==' }],
    apiKey: 'synthetic-local-only', permissions: { getMode: () => 'workspace-write' },
    emit: (type, payload) => events.push({ type, payload }),
    provider: { id: 'fixture', name: 'Local team fixture', model: 'fixture-model', api: 'openai-completions', imageInput: true,
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`, contextWindow: 128000, maxTokens: 2048 } });
  assert.ok(requests.every(body => JSON.stringify(body.messages).includes('APPROVED_PARENT_PLAN_BLUE')
    && JSON.stringify(body.messages).includes('APPROVED_PARENT_REPLY_BLUE')), 'real provider receives parent text for every role');
  assert.ok(requests.every(body => JSON.stringify(body.messages).includes('image_url')), 'real provider receives original image for every role: ' + JSON.stringify(requests.map(body => ({ tools: body.tools?.map(x => x.function.name), types: body.messages.filter(x => x.role === 'user').map(x => Array.isArray(x.content) ? x.content.map(p => p.type) : typeof x.content) }))));
  const usage = events.filter(event => event.type === 'usage');
  assert.equal(usage.length, requests.length, 'real SDK emits each reported local provider usage');
  assert.ok(usage.every(event => event.payload.inputTokens === 10 && event.payload.outputTokens === 2
    && event.payload.totalTokens === 12 && event.payload.teamId === base().task.id));
  assert.deepEqual(usage.reduce((totals, event) => ({ ...totals,
    [event.payload.member]: (totals[event.payload.member] ?? 0) + event.payload.totalTokens }), {}),
    { captain: 36, implementer: 24, verifier: 36 });
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


test('public node receipts distinguish failed tools, missing verdict and explicit rejection without member prose', async () => {
  for (const kind of ['verified', 'rejected', 'missing_verdict', 'tool_failure']) {
    const events = [];
    const run = async options => {
      if (options.task.text.includes('你是队长。')) await submit(options, 'team_plan', plan);
      else if (options.sessionPolicy.customTools?.some(tool => tool.name === 'team_verdict')) {
        evidence(options);
        if (kind === 'tool_failure') options.emit('tool_end', { toolName: 'bash', isError: true, result: {} });
        // tool_failure is reachable only without a submitted verdict; a passed=true verdict
        // with failed tool evidence is rejected by the verdict guard itself.
        if (kind !== 'missing_verdict' && kind !== 'tool_failure') await submit(options, 'team_verdict', { passed: kind === 'verified', summary: 'private verdict sk-secret' });
      }
      return { text: 'private member response' };
    };
    const execution = runPiTeam({ ...base(), emit: (type, payload) => events.push({ type, payload }) }, run);
    if (kind === 'verified') await execution; else await assert.rejects(execution);
    const node = events.find(event => event.payload.nodeId === 'check' && ['blocked', 'completed'].includes(event.payload.phase)).payload;
    assert.equal(node.outcome.code, kind);
    assert.equal(node.outcome.toolsSucceeded, 1);
    assert.equal(node.outcome.evidenceCount, 1);
    assert.equal(node.outcome.toolsFailed, kind === 'tool_failure' ? 1 : 0);
    // An explicit passed=false verdict is a rejection even when a probe tool errored.
    assert.doesNotMatch(JSON.stringify(node.outcome), /private|secret/);
    assert.equal(events.some(event => event.payload.phase === 'succeeded'), kind === 'verified');
  }
});

test('usage preserves reported fields and stamps the owning live role attempt including compaction', async () => {
  const events = [], reports = [];
  const runner = fakeRun(); let late;
  await runPiTeam({ ...base(), emit: (type, payload) => events.push({ type, payload }) }, async options => {
    const report = { inputTokens: 17, outputTokens: 3, totalTokens: 20, providerId: 'synthetic',
      teamId: 'forged', member: 'forged', attemptId: 'forged' };
    options.emit('usage', report); options.emit('usage', { ...report, kind: 'compaction' });
    reports.push(report); late = () => options.emit('usage', report);
    return runner(options);
  });
  const usages = events.filter(event => event.type === 'usage');
  assert.equal(usages.length, 8);
  for (const { payload } of usages) {
    assert.equal(payload.teamId, 'task-a'); assert.equal(payload.totalTokens, 20);
    assert.equal(payload.providerId, 'synthetic');
    assert.ok(events.some(event => event.type === 'team_state' && event.payload.phase === 'running'
      && event.payload.member === payload.member && event.payload.attemptId === payload.attemptId));
  }
  assert.deepEqual(usages.map(event => event.payload.kind), [undefined, 'compaction', undefined, 'compaction', undefined, 'compaction', undefined, 'compaction']);
  assert.equal(new Set(usages.map(event => event.payload.attemptId)).size, 4);
  late(); assert.equal(events.filter(event => event.type === 'usage').length, 8);
  assert.ok(reports.every(report => report.teamId === 'forged'), 'input payloads are not mutated');
});

test('member turn retries once on model-side network stream drop, not on other failures', async () => {
  const trace = [], events = [];
  let memberCalls = 0;
  const flakyRun = async options => {
    options.sessionPolicy.beforeRequest();
    if (options.task.text.includes('你是队长。')) { await submit(options, 'team_plan', plan); return { text: 'planned' }; }
    if (options.task.text.includes('独立成员已执行并提交验收结果')) return { text: 'verified' };
    if (options.task.text.includes('独立验证')) {
      evidence(options);
      await submit(options, 'team_verdict', { passed: true, summary: 'checked actual file' });
      return { text: 'verified' };
    }
    memberCalls += 1;
    if (memberCalls === 1) throw new TaskFailure('network');
    return { text: 'implementer done' };
  };
  const result = await runPiTeam({ ...base(), emit: (type, payload) => events.push({ type, payload }) }, flakyRun);
  assert.equal(result.text, 'verified');
  assert.equal(memberCalls, 2);
  assert.ok(events.some(event => event.type === 'team_state' && event.payload.phase === 'running' && event.payload.retried === true));

  memberCalls = 0;
  const twiceRun = async options => {
    options.sessionPolicy.beforeRequest();
    if (options.task.text.includes('你是队长。')) { await submit(options, 'team_plan', plan); return { text: 'planned' }; }
    memberCalls += 1;
    throw new TaskFailure('network');
  };
  await assert.rejects(
    () => runPiTeam({ ...base(), emit: () => {} }, twiceRun),
    error => error instanceof TaskFailure && error.code === 'network',
  );
  assert.equal(memberCalls, 2, 'only one bounded retry');
});


test('network failure after any tool starts never automatically replays side effects', async () => {
  let calls = 0;
  await assert.rejects(() => runPiTeam(base(), async options => {
    if (options.task.text.includes('你是队长。')) {
      await submit(options, 'team_plan', plan); return { text: 'plan' };
    }
    calls++;
    options.emit('tool_start', { toolName: 'bash', toolCallId: 'write-once' });
    throw new TaskFailure('network');
  }), error => error.code === 'network');
  assert.equal(calls, 1, 'execution may have changed files even without tool_end');
});

test('every member receives bounded parent text and original images in its own session', async () => {
  const calls = [];
  const history = [{ role: 'user', text: 'Use the agreed blue design', timestamp: 1 },
    { role: 'assistant', text: 'The approved plan is blue', timestamp: 2 }];
  const images = [{ type: 'image', mimeType: 'image/png', data: 'test-image' }];
  await runPiTeam({ ...base(), fork: { history, origin: { conversationId: 'parent' } }, images }, async options => {
    calls.push(options); return fakeRun()(options);
  });
  assert.equal(calls.length, 4);
  for (const call of calls) {
    assert.deepEqual(call.fork, { history });
    assert.deepEqual(call.images, images);
    assert.notEqual(call.conversation.id, 'chat-a');
  }
});


test('default team budget does not stop at the former 200 requests or 2M token caps', async () => {
  const events = [];
  let calls = 0;
  const result = await runPiTeam({ ...base(), emit: (type, payload) => events.push({ type, payload }) }, async options => {
    calls++;
    for (let i = 0; i < 70; i++) options.sessionPolicy.beforeRequest();
    options.emit('usage', { inputTokens: 2100000, outputTokens: 1, cacheReadTokens: 5000000 });
    return fakeRun()(options);
  });
  assert.equal(result.text, 'real member result');
  assert.equal(calls, 4);
  assert.ok(events.some(e => e.type === 'team_budget' && e.payload.phase === 'configured'
    && e.payload.limits.tokens === null && e.payload.limits.requests === null));
});

test('optional team budget validates limits before execution and snapshots caller values', async () => {
  for (const budget of [null, [], { tokens: 0 }, { tokens: -1 }, { tokens: 1.5 },
    { tokens: '100' }, { requests: Infinity }, { requests: Number.MAX_SAFE_INTEGER + 1 }, { unknown: 5 }]) {
    let called = false;
    await assert.rejects(runPiTeam({ ...base(), teamBudget: budget }, async () => { called = true; }), /Invalid team budget/);
    assert.equal(called, false);
  }
  const teamBudget = { tokens: 10, requests: 10 };
  let rounds = 0;
  await assert.rejects(runPiTeam({ ...base(), teamBudget }, async options => {
    teamBudget.tokens = null;
    rounds++;
    options.emit('usage', { inputTokens: 11, outputTokens: 0 });
    return fakeRun()(options);
  }), error => error.code === 'team_budget');
  assert.equal(rounds, 1, 'changing a shared object cannot remove the active budget');
});
