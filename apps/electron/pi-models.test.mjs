import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkedProvider } from '../../packages/pi-adapter/index.mjs';
import { runPiSdk } from '../../packages/pi-runtime/sdk-runtime.mjs';
import { startFixture } from '../../services/agent/fixture.mjs';
import { Scheduler } from '../../services/agent/scheduler.mjs';
import { Store } from '../../services/agent/store.mjs';
import { piModels } from './plugin/pi-models.js';
import { createPiAdapter } from './plugin/pi-route.js';
import { createPiTasks } from './plugin/pi-tasks.js';

test('a configured desktop profile runs arbitrary workspace text through PI with native High', async t => {
  const data = await mkdtemp(join(tmpdir(), 'moos-pi-models-'));
  const cwd = join(data, 'workspace', 'project');
  await mkdir(cwd, { recursive: true });
  const requests = [];
  const fixture = await startFixture({ desktopPolicy: true,
    onModelRequest: body => requests.push({ model: body.model, effort: body.reasoning?.effort, thinking: body.thinking?.type }) });
  const models = piModels(data, checkedProvider);
  const profile = { id: 'relay', name: 'Relay', model: 'mock-gpt', baseUrl: fixture.baseUrl,
    api: 'openai-responses', thinkingLevel: 'high', apiKey: fixture.apiKey };
  await models.save(profile);
  await models.save({ ...profile, apiKey: '' });
  await models.save({ id: 'glm', name: 'GLM', model: 'mock-glm', baseUrl: fixture.baseUrl,
    service: 'glm', api: 'openai-completions', apiKey: fixture.apiKey });
  assert.equal((await models.resolve('auto')).id, 'glm');
  const relay = await models.resolve('relay');
  assert.equal(await models.credential(relay), fixture.apiKey);
  const moved = { ...relay, baseUrl: fixture.baseUrl + '/another-service' };
  await assert.rejects(models.save({ ...moved, apiKey: '' }), /API key/);
  await assert.rejects(models.credential(moved), /service address/);
  assert.equal((await stat(join(data, 'private'))).mode & 0o777, 0o700);
  assert.equal((await stat(join(data, 'private', 'credentials.json'))).mode & 0o777, 0o600);
  assert.ok(!(await readFile(join(data, 'providers.json'), 'utf8')).includes(fixture.apiKey));

  const store = new Store({ dbPath: join(data, 'moos.sqlite') });
  const tasks = createPiTasks({ store, Scheduler, run: async options => runPiSdk({
    ...options, dataDir: join(data, 'sessions'), apiKey: await models.credential(options.provider),
  }) });
  t.after(async () => {
    try { await tasks.close(); }
    finally { await fixture.close(); await rm(data, { recursive: true, force: true }); }
  });
  const adapter = createPiAdapter({ tasks, models, getSession: () => ({ header: { cwd } }),
    getPermissions: () => ({ getMode: () => 'workspace-write' }) });
  const call = await adapter.prepareCall('moos-pi', 'relay');
  assert.equal(call.model.id, 'relay');
  const chunks = [];
  for await (const event of call.stream({ model: 'relay', sessionId: 'main',
    messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '请回复 MOOS_FIXTURE_RESPONSES' }] }] })) {
    chunks.push(event);
  }
  assert.equal(chunks.at(-1).reason.kind, 'stop');
  assert.ok(chunks.some(chunk => chunk.text?.includes('Responses SDK ready')));
  const title = [];
  const humanMessages = JSON.stringify([{ seq: 1, text: '修复文件\n细节' }]);
  for await (const event of call.stream({ purpose: 'session-title', messages: [
    { role: 'user', content: [{ type: 'text',
      text: 'Generate the session title from this JSON array of human messages:\n' + humanMessages }] },
  ] })) title.push(event);
  assert.ok(title.some(chunk => chunk.text === '修复文件'));
  assert.deepEqual(requests, [{ model: 'mock-gpt', effort: 'high', thinking: undefined }]);

  const automatic = await adapter.prepareCall('moos-pi', 'auto');
  const events = [];
  for await (const event of automatic.stream({ model: 'auto', sessionId: 'automatic',
    messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'MOOS_FIXTURE_WRITE glm_auto' }] }] })) {
    events.push(event);
  }
  assert.equal(events.at(-1).reason.kind, 'stop');
  assert.equal(await readFile(join(cwd, 'result.txt'), 'utf8'), 'glm_auto\n');
  assert.deepEqual(requests.slice(1).map(request => request.model), Array(3).fill('mock-glm'));
  assert.equal(store.listTasks().length, 2);
});
