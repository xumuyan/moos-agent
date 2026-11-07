import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runPiSdk } from '../../packages/pi-runtime/sdk-runtime.mjs';
import { repairRouting } from '../../packages/pi-runtime/repair-routing.mjs';
import { startFixture } from '../../services/agent/fixture.mjs';

test('PI switches provider and protocol at most once and keeps repairs in the same context', async t => {
  const root = await mkdtemp(join(tmpdir(), 'moos-routing-'));
  const cwd = join(root, 'project');
  await mkdir(cwd);
  await writeFile(join(cwd, 'test.sh'), "printf 'Fixture assertion failed\n'\nexit 1\n");
  const requests = [];
  const fixture = await startFixture({ routingTest: true, onModelRequest: request => requests.push(request) });
  t.after(async () => { await fixture.close(); await rm(root, { recursive: true, force: true }); });
  const primary = { id: 'glm', name: 'GLM', service: 'glm', api: 'openai-completions', baseUrl: fixture.baseUrl,
    model: 'mock-glm', contextWindow: 128000, maxTokens: 8192 };
  const strong = { ...primary, id: 'relay', name: 'Relay High', service: 'openai', api: 'openai-responses',
    model: 'mock-gpt', contextWindow: 200000, thinkingLevel: 'high' };
  const events = [];
  const run = (name, backup = true) => {
    requests.length = 0;
    events.length = 0;
    return runPiSdk({ task: 'MOOS_ROUTE_' + name, project: { path: cwd }, conversation: { id: name },
      provider: primary, apiKey: fixture.apiKey, dataDir: join(root, 'sessions'),
      permissions: { getMode: () => 'workspace-write' },
      routing: backup ? { backup: { provider: strong, apiKey: fixture.apiKey, repair: true } } : undefined,
      emit: (type, payload) => events.push({ type, payload }),
    });
  };
  const switches = () => events.filter(event => event.type === 'model_route').map(event => event.payload);

  assert.match((await run('QUOTA')).text, /Backup PI route ready/);
  assert.deepEqual(requests.map(request => request.model), ['mock-glm', 'mock-gpt']);
  assert.equal(requests[1].reasoning.effort, 'high');
  assert.equal(JSON.stringify(requests[1].input).match(/MOOS_ROUTE_QUOTA/g).length, 1);
  assert.deepEqual(switches(), [{ from: 'GLM', to: 'Relay High', reason: 'quota' }]);
  assert.ok(events.some(event => event.type === 'usage' && event.payload.providerId === 'relay' && event.payload.contextWindow === 200000));

  await assert.rejects(run('QUOTA', false), { code: 'quota' });
  assert.equal(requests.length, 1);
  assert.deepEqual(switches(), []);
  await assert.rejects(run('AUTH'), { code: 'auth' });
  assert.equal(requests.length, 1);
  assert.deepEqual(switches(), []);
  assert.match((await run('GLM_QUOTA')).text, /Backup PI route ready/);
  assert.deepEqual(requests.map(request => request.model), ['mock-glm', 'mock-gpt']);
  assert.deepEqual(switches(), [{ from: 'GLM', to: 'Relay High', reason: 'quota' }]);
  for (const [scenario, code] of [['GLM_MODEL', 'model_capability'], ['GLM_CREDENTIAL', 'auth']]) {
    await assert.rejects(run(scenario), { code });
    assert.equal(requests.length, 1);
    assert.deepEqual(switches(), []);
  }
  await assert.rejects(run('BOTH'), { code: 'network' });
  assert.deepEqual(requests.map(request => request.model), ['mock-glm', 'mock-gpt']);
  assert.deepEqual(switches(), [{ from: 'GLM', to: 'Relay High', reason: 'rate_limit' }]);
  await assert.rejects(run('AFTER_TOOL'), { code: 'rate_limit' });
  assert.deepEqual(requests.map(request => request.model), ['mock-glm', 'mock-glm']);
  assert.equal(await readFile(join(cwd, 'once.txt'), 'utf8'), 'written once\n');
  assert.deepEqual(switches(), []);

  assert.match((await run('REPAIR')).text, /Backup PI route ready/);
  assert.deepEqual(requests.map(request => request.model), [...Array(5).fill('mock-glm'), 'mock-gpt']);
  assert.equal(requests.at(-1).reasoning.effort, 'high');
  assert.match(JSON.stringify(requests.at(-1).input), /Fixture assertion failed/);
  assert.match(JSON.stringify(requests.at(-1).input), /repair 3/);
  assert.equal(await readFile(join(cwd, 'repair.txt'), 'utf8'), 'repair 3\n');
  assert.deepEqual(switches(), [{ from: 'GLM', to: 'Relay High', reason: 'repair' }]);
});

test('repair escalation ignores repeated tests without repairs, new errors, and missing dependencies', () => {
  const policy = repairRouting();
  const testRun = (text, isError = true) => {
    policy.event({ type: 'tool_execution_start', toolName: 'bash', toolCallId: 'check', args: { command: 'npm test' } });
    policy.event({ type: 'tool_execution_end', toolName: 'bash', toolCallId: 'check', isError,
      result: { structuredContent: { exit_code: isError ? 1 : 0 }, content: [{ type: 'text', text }] } });
  };
  const edit = () => policy.event({ type: 'tool_execution_end', toolName: 'edit', isError: false });
  testRun('assertion A');
  testRun('assertion A');
  testRun('assertion A');
  assert.equal(policy.ready(), false);
  for (let i = 0; i < 3; i++) { edit(); testRun('Cannot find module missing'); }
  assert.equal(policy.ready(), false);
  edit(); testRun('assertion A'); edit(); testRun('assertion B'); edit(); testRun('assertion B');
  assert.equal(policy.ready(), false);
  testRun('passed', false); edit(); testRun('assertion B');
  assert.equal(policy.ready(), false);
  const cargoStart = () => policy.event({ type: 'tool_execution_start', toolName: 'bash', toolCallId: 'cargo', args: { command: 'cargo test' } });
  const cargoEnd = () => policy.event({ type: 'tool_execution_end', toolName: 'bash', toolCallId: 'cargo', isError: true,
    result: { structuredContent: { exit_code: 1 }, content: [{ type: 'text', text: 'parallel assertion' }] } });
  cargoStart(); cargoEnd();
  for (let i = 0; i < 2; i++) {
    cargoStart();
    edit();
    cargoEnd();
  }
  assert.equal(policy.ready(), false); // the second check had already started when its edit completed
  cargoStart(); cargoEnd();
  assert.equal(policy.ready(), true);
});
