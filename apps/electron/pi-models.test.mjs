import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkedProvider } from '../../packages/pi-adapter/index.mjs';
import { runPiSdk } from '../../packages/pi-runtime/sdk-runtime.mjs';
import { startFixture } from '../../services/agent/fixture.mjs';
import { diagnoseProvider } from '../../services/agent/provider-diagnostics.mjs';
import { Scheduler } from '../../services/agent/scheduler.mjs';
import { Store } from '../../services/agent/store.mjs';
import { piModels } from './plugin/pi-models.js';
import { createPiAdapter } from './plugin/pi-route.js';
import { createPiTasks } from './plugin/pi-tasks.js';

test('model settings test drafts safely without saving or forwarding a saved key to another address', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'moos-model-diagnostic-'));
  let requests = 0;
  const fixture = await startFixture({ onModelRequest() { requests++; } });
  t.after(async () => { await fixture.close(); await rm(dir, { recursive: true, force: true }); });
  const models = piModels(dir, checkedProvider);
  const draft = { id: '', model: 'fixture', api: 'openai-responses', baseUrl: fixture.baseUrl, apiKey: fixture.apiKey };
  assert.equal((await models.testConnection(draft, diagnoseProvider)).code, 'ok');
  assert.deepEqual(await models.list(), []);
  await models.save({ ...draft, id: 'saved' });
  const saved = { ...(await models.resolve('saved')), apiKey: '' };
  const result = await models.testConnection(saved, diagnoseProvider);
  assert.equal(result.status, 200);
  assert.equal(result.code, 'ok');
  assert.equal(requests, 2);
  const moved = await models.testConnection({ ...saved, baseUrl: fixture.baseUrl + '/elsewhere' }, diagnoseProvider);
  assert.equal(moved.code, 'missing_key');
  assert.equal(requests, 2);
  const invalid = await models.testConnection({ ...saved, apiKey: 'deliberately-invalid-key' }, diagnoseProvider);
  assert.equal(invalid.code, 'auth');
  assert.equal(invalid.status, 401);
  assert.doesNotMatch(JSON.stringify(result) + JSON.stringify(invalid), /fixture-test-only|deliberately-invalid/);
  assert.equal(await models.credential(saved), fixture.apiKey);
});

test('one connection shares a credential across models and retains legacy model IDs', async t => {
  const data = await mkdtemp(join(tmpdir(), 'moos-model-groups-'));
  const fixture = await startFixture();
  t.after(async () => { await fixture.close(); await rm(data, { recursive: true, force: true }); });
  const models = piModels(data, checkedProvider);
  const base = { name: 'Relay', baseUrl: fixture.baseUrl, api: 'openai-responses' };
  await models.save({ ...base, id: 'existing', model: 'fixture', apiKey: fixture.apiKey });
  const [legacy] = await models.groups();
  const [group] = await models.saveGroup({ ...legacy, apiKey: '', models: [
    { ...legacy.models[0], thinkingLevel: 'high' },
    { id: 'other-model', thinkingLevel: 'low' },
  ] });
  assert.equal(group.id, 'existing');
  assert.equal(group.models[0].profileId, 'existing');
  assert.deepEqual(group.models.map(model => model.thinkingLevel), ['high', 'low']);
  const second = await models.resolve(group.models[1].profileId);
  assert.equal(await models.credential(second), fixture.apiKey);
  assert.equal((await models.resolve('existing')).credentialId, second.credentialId);
  assert.deepEqual((await models.diagnoseGroup('list_models', group, diagnoseProvider)).models, ['fixture']);
  assert.equal((await models.diagnoseGroup('test_provider', { ...group, model: group.models[0] }, diagnoseProvider)).code, 'ok');
  const moved = { ...group, baseUrl: fixture.baseUrl + '/other' };
  await assert.rejects(models.saveGroup(moved), /API key/);
  assert.equal((await models.diagnoseGroup('list_models', moved, diagnoseProvider)).code, 'missing_key');
  assert.deepEqual(await models.groups(), [group]);
  await assert.rejects(models.saveGroup({ ...group, models: [group.models[0], group.models[0]] }), /Duplicate/);
  const [fresh] = await piModels(data, checkedProvider).groups();
  assert.deepEqual(fresh, group);
  const [edited] = await models.saveGroup({ ...group, models: [group.models[1]] });
  assert.equal(edited.models[0].profileId, second.id);
  assert.equal(await models.resolve('existing'), undefined);
  assert.equal(await models.credential(await models.resolve(second.id)), fixture.apiKey);
  assert.doesNotMatch(JSON.stringify(await models.groups()), /apiKey|credentialId/);
});

test('a configured desktop profile runs arbitrary workspace text through PI with native High', async t => {
  const data = await mkdtemp(join(tmpdir(), 'moos-pi-models-'));
  const cwd = join(data, 'workspace', 'project');
  await mkdir(cwd, { recursive: true });
  const requests = [];
  const imageRequests = [];
  const fixture = await startFixture({ desktopPolicy: true,
    onModelRequest(body) {
      requests.push({ model: body.model, effort: body.reasoning?.effort, thinking: body.thinking?.type });
      imageRequests.push(JSON.stringify(body).includes('data:image/'));
    } });
  const models = piModels(data, checkedProvider);
  const profile = { id: 'relay', name: 'Relay', model: 'mock-gpt', baseUrl: fixture.baseUrl,
    api: 'openai-responses', thinkingLevel: 'high', apiKey: fixture.apiKey };
  await models.save(profile);
  await models.save({ ...profile, apiKey: '' });
  await models.save({ id: 'glm', name: 'GLM', model: 'mock-glm', baseUrl: fixture.baseUrl,
    service: 'glm', api: 'openai-completions', apiKey: fixture.apiKey });
  assert.equal((await models.resolve('auto')).id, 'glm');
  assert.equal((await models.plan('auto')).backup.provider.id, 'relay');
  assert.equal((await models.plan('auto')).backup.repair, true);
  assert.equal((await models.plan('glm')).backup, undefined);
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

  await models.save({ ...relay, imageInput: true, apiKey: '' });
  assert.equal((await models.plan('auto', true)).provider.id, 'relay');
  assert.equal((await models.plan('auto', true)).backup, undefined);
  assert.equal((await models.plan('glm', true)).provider, undefined);
  const imageData = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAIAAAAt/+nTAAAASElEQVR4nO3PwQkAMBCEwO2/6aSIe4ggTAG6t6nxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QVHHzLD+GoHbk06AAAAAElFTkSuQmCC', 'base64');
  const vision = createPiAdapter({ tasks, models, getSession: () => ({ header: { cwd } }),
    readImage: async () => ({ data: imageData }), getPermissions: () => ({ getMode: () => 'workspace-write' }) });
  assert.deepEqual((await vision.resolveModel('moos-pi', 'auto')).inputModalities, ['text', 'image']);
  const image = { type: 'image', attachment: { attachmentId: 'sha256:' + 'a'.repeat(64),
    mediaType: 'image/png', width: 64, height: 32, bytes: imageData.length } };
  async function turn(model, content, rpcId, sessionId = 'vision') {
    const output = [];
    for await (const event of vision.stream({ model, sessionId,
      messages: [{ role: 'user', source: { kind: 'user', rpcId }, content }] })) output.push(event);
    return output.at(-1).reason;
  }
  const content = [{ type: 'text', text: 'MOOS_FIXTURE_RESPONSES' }, image];
  assert.equal((await turn('glm', content)).failure.code, 'INVALID_CONFIG');
  assert.equal((await turn('auto', [image, image])).failure.code, 'INVALID_REQUEST');
  assert.equal((await turn('auto', content)).kind, 'stop');
  assert.equal(requests.at(-1).model, 'mock-gpt');
  assert.equal(imageRequests.at(-1), true);
  const priorRequestCount = requests.length;
  assert.equal((await turn('auto', [{ type: 'text', text: 'MOOS_FIXTURE_WRITE no_previous_image' }])).kind, 'stop');
  assert.ok(imageRequests.slice(priorRequestCount).every(hasImage => !hasImage));
  assert.equal((await turn('auto', [{ type: 'text', text: 'fixture-invalid' }, image], undefined, 'vision-retry')).kind, 'error');
  const failed = store.listTasks()[0];
  assert.deepEqual(tasks.retryImage('vision-retry', failed.id), image.attachment);
  assert.throws(() => tasks.retryImage('another-session', failed.id));
  assert.equal((await turn('auto', [{ type: 'text', text: 'MOOS_FIXTURE_RESPONSES' }],
    `moos-pi-retry:${failed.id}:00000000-0000-4000-8000-000000000001`, 'vision-retry')).kind, 'error');
  assert.equal(imageRequests.at(-1), true);

  await models.save({ id: 'custom-deepseek', name: 'Custom DeepSeek', model: 'mock-deepseek',
    baseUrl: fixture.baseUrl, service: 'deepseek', api: 'openai-completions', apiKey: fixture.apiKey });
  assert.equal((await models.plan('custom-deepseek')).backup, undefined);
  const beforeDeepSeek = requests.length;
  assert.equal((await turn('custom-deepseek', [{ type: 'text', text: 'MOOS_FIXTURE_WRITE custom_deepseek' }],
    undefined, 'custom-deepseek')).kind, 'stop');
  assert.deepEqual(requests.slice(beforeDeepSeek).map(request => request.model), Array(3).fill('mock-deepseek'));
  assert.equal(await readFile(join(cwd, 'result.txt'), 'utf8'), 'custom_deepseek\n');

  const [, , , shared] = await models.saveGroup({
    name: 'Two models', baseUrl: fixture.baseUrl, api: 'openai-responses', apiKey: fixture.apiKey,
    models: [{ id: 'relay-a', thinkingLevel: 'high' }, { id: 'relay-b', thinkingLevel: 'low' }],
  });
  assert.equal(shared.models.length, 2);
  const beforeShared = requests.length;
  for (const model of shared.models) {
    assert.equal((await turn(model.profileId, [{ type: 'text', text: 'MOOS_FIXTURE_RESPONSES' }],
      undefined, model.profileId)).kind, 'stop');
  }
  assert.deepEqual(requests.slice(beforeShared).map(({ model, effort }) => [model, effort]),
    [['relay-a', 'high'], ['relay-b', 'low']]);
});
