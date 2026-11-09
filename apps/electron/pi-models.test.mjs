import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkedProvider } from '../../packages/pi-adapter/index.mjs';
import { runPiSdk } from '../../packages/pi-runtime/sdk-runtime.mjs';
import { startFixture } from '../../services/agent/fixture.mjs';
import { startMockImagesServer } from '../../packages/pi-runtime/mock-images-server.mjs';
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
  assert.equal(edited.keyConfigured, true);
  await models.removeGroup(group.id);
  assert.deepEqual(await models.groups(), []);
  assert.deepEqual(JSON.parse(await readFile(join(data, 'private', 'credentials.json'), 'utf8')), {});
  await models.removeGroup(group.id);
  const draft = { ...base, route: 'test-relay', apiKey: fixture.apiKey, models: [{ id: 'fixture' }] };
  const [created] = await models.saveGroup(draft);
  assert.equal(created.id, 'test-relay');
  await assert.rejects(models.saveGroup(draft), /duplicate/);
  await assert.rejects(models.saveGroup({ ...draft, route: 'auto' }), /Invalid/);
  const [renamed] = await models.saveGroup({ ...created, route: 'other-relay', name: 'New display name' });
  assert.equal(renamed.id, 'test-relay');
  assert.equal(renamed.models[0].profileId, created.models[0].profileId);
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
  assert.deepEqual((await vision.resolveModel('moos-pi', 'relay')).inputModalities, ['text', 'image']);
  assert.deepEqual((await vision.resolveModel('moos-pi', 'glm')).inputModalities, ['text']);
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
  const overrideId = shared.models[0].profileId;
  assert.equal((await adapter.resolveModel('moos-pi', overrideId)).reasoning.defaultEffort, 'high');
  assert.equal((await adapter.resolveModel('moos-pi', 'auto')).reasoning, undefined);
  const overridden = [];
  for await (const event of adapter.stream({ model: overrideId, reasoningEffort: 'medium', sessionId: 'override',
    messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'MOOS_FIXTURE_RESPONSES' }] }] })) {
    overridden.push(event);
  }
  assert.equal(overridden.at(-1).reason.kind, 'stop');
  assert.deepEqual(requests.at(-1), { model: 'relay-a', effort: 'medium', thinking: undefined });
  assert.equal((await models.resolve(overrideId)).thinkingLevel, 'high');

  const newSite = (await models.saveGroup({
    name: 'New site', baseUrl: fixture.baseUrl, api: 'openai-responses', apiKey: fixture.apiKey,
    models: [{ id: 'relay-a' }],
  })).find(group => group.name === 'New site');
  const offId = newSite.models[0].profileId;
  const catalog = await adapter.listModels();
  assert.equal(catalog[0].menuSite, undefined);
  assert.deepEqual(catalog.find(model => model.id === 'relay').menuSite, { id: 'relay', name: 'Relay' });
  assert.deepEqual(catalog.filter(model => model.menuSite?.id === shared.id).map(model => model.id),
    shared.models.map(model => model.profileId));
  const offModel = await adapter.resolveModel('moos-pi', offId);
  assert.deepEqual(offModel.menuSite, { id: newSite.id, name: 'New site' });
  assert.equal(offModel.reasoning.defaultEffort, 'off');
  assert.ok(offModel.reasoning.efforts.some(level => level.id === 'high'));
  assert.notEqual(offId, overrideId);
  const offEvents = [];
  for await (const event of adapter.stream({ model: offId, reasoningEffort: 'high', sessionId: 'off-override',
    messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'MOOS_FIXTURE_RESPONSES' }] }] })) {
    offEvents.push(event);
  }
  assert.equal(offEvents.at(-1).reason.kind, 'stop');
  assert.deepEqual(requests.at(-1), { model: 'relay-a', effort: 'high', thinking: undefined });
  assert.equal((await models.resolve(offId)).thinkingLevel, 'off');
});

test('image input survives unrelated group edits but is not inferred or transferred to another model or endpoint', async t => {
  const data = await mkdtemp(join(tmpdir(), 'moos-image-capability-'));
  t.after(() => rm(data, { recursive: true, force: true }));
  const models = piModels(data, checkedProvider);
  const base = { route: 'vision-relay', name: 'Vision Relay', service: 'openai',
    api: 'openai-completions', baseUrl: 'https://fixture.example/v1', apiKey: 'synthetic-fixture-key' };
  let [group] = await models.saveGroup({ ...base, models: [{ id: 'gpt-fixture', input: ['text', 'image'] }] });
  const originalId = group.models[0].profileId;
  const credentials = await readFile(join(data, 'private/credentials.json'));
  const { input, ...textEdit } = group.models[0];
  [group] = await models.saveGroup({ ...group, models: [{ ...textEdit, thinkingLevel: 'high' }] });
  assert.deepEqual(group.models[0].input, ['text', 'image']);
  assert.equal(group.models[0].profileId, originalId);
  assert.deepEqual(await readFile(join(data, 'private/credentials.json')), credentials);
  assert.equal((await models.plan(originalId, true)).provider.id, originalId);
  [group] = await models.saveGroup({ ...group, models: [{ ...group.models[0], input: ['text'] }] });
  assert.equal((await models.plan(originalId, true)).provider, undefined);
  [group] = await models.saveGroup({ ...group, models: [{ ...group.models[0], input: ['text', 'image'] }] });
  [group] = await models.saveGroup({ ...group, models: [{ ...textEdit, id: 'another-gpt' }] });
  assert.equal((await models.plan(originalId, true)).provider, undefined);
  [group] = await models.saveGroup({ ...group, models: [{ ...group.models[0], input: ['text', 'image'] }] });
  const { input: _ignored, ...movedModel } = group.models[0];
  [group] = await models.saveGroup({ ...group, baseUrl: 'https://other-fixture.example/v1',
    apiKey: 'other-synthetic-key', models: [movedModel] });
  assert.equal((await models.plan(originalId, true)).provider, undefined);
});

test('GLM Responses groups save, reopen and run diagnostics without changing service or protocol', async t => {
  const data = await mkdtemp(join(tmpdir(), 'moos-glm-responses-'));
  const fixture = await startFixture();
  t.after(async () => { await fixture.close(); await rm(data, { recursive: true, force: true }); });
  const models = piModels(data, checkedProvider);
  const [group] = await models.saveGroup({ route: 'glm-responses', name: 'GLM Coding Plan',
    baseUrl: fixture.baseUrl, api: 'openai-responses', service: 'glm', apiKey: fixture.apiKey,
    models: [{ id: 'fixture' }] });
  const [reopened] = await piModels(data, checkedProvider).groups();
  assert.deepEqual(reopened, group);
  assert.equal(reopened.service, 'glm');
  assert.equal(reopened.api, 'openai-responses');
  const before = await readFile(join(data, 'private/credentials.json'));
  assert.equal((await models.diagnoseGroup('test_provider', { ...reopened, model: reopened.models[0] }, diagnoseProvider)).code, 'ok');
  assert.deepEqual(await readFile(join(data, 'private/credentials.json')), before);
  const [edited] = await models.saveGroup({ ...reopened, models: [{ ...reopened.models[0], name: 'Renamed' }] });
  assert.equal(edited.api, 'openai-responses');
  assert.deepEqual(await readFile(join(data, 'private/credentials.json')), before);
  const cwd = join(data, 'workspace');
  await mkdir(cwd);
  const store = new Store({ dbPath: join(data, 'moos.sqlite') });
  const tasks = createPiTasks({ store, Scheduler, run: async options => runPiSdk({
    ...options, dataDir: join(data, 'sessions'), apiKey: await models.credential(options.provider),
  }) });
  t.after(() => tasks.close());
  const adapter = createPiAdapter({ tasks, models, getSession: () => ({ header: { cwd } }),
    getPermissions: () => ({ getMode: () => 'workspace-write' }) });
  const call = await adapter.prepareCall('moos-pi', edited.models[0].profileId);
  const chunks = [];
  for await (const event of call.stream({ model: edited.models[0].profileId, sessionId: 'glm-responses',
    messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'MOOS_FIXTURE_RESPONSES' }] }] })) chunks.push(event);
  assert.equal(chunks.at(-1).reason.kind, 'stop');
  assert.ok(chunks.some(chunk => chunk.text?.includes('Responses SDK ready')));
});

test('GLM profiles accept the official max effort and tolerate legacy levels', async t => {
  const data = await realpath(await mkdtemp(join(tmpdir(), 'moos-glm-levels-')));
  t.after(async () => { await rm(data, { recursive: true, force: true }); });
  const models = piModels(data, checkedProvider);
  await models.save({ id: 'glm-max', name: 'GLM Max', model: 'mock-glm', baseUrl: 'http://127.0.0.1:9/v1',
    service: 'glm', api: 'openai-responses', thinkingLevel: 'max', apiKey: 'sk-local-test' });
  assert.equal((await models.resolve('glm-max')).thinkingLevel, 'max');
  await models.save({ id: 'glm-legacy', name: 'GLM Legacy', model: 'mock-glm', baseUrl: 'http://127.0.0.1:9/v1',
    service: 'glm', api: 'openai-responses', thinkingLevel: 'xhigh', apiKey: 'sk-local-test' });
  assert.equal((await models.resolve('glm-legacy')).thinkingLevel, 'xhigh', 'legacy levels stay readable');
});

test('image generation settings round-trip through private storage without leaking the key', async t => {
  const data = await realpath(await mkdtemp(join(tmpdir(), 'moos-image-settings-')));
  const fixture = await startMockImagesServer({});
  t.after(async () => { await fixture.close(); await rm(data, { recursive: true, force: true }); });
  const models = piModels(data, checkedProvider);
  // 初始状态：未配置，imageGen() 返回 null（host 不注入，工具不挂载）。
  assert.deepEqual(await models.imageStatus(), { enabled: false, baseUrl: '', model: 'gpt-image-2.5-flare', keyConfigured: false });
  assert.equal(await models.imageGen(), null);
  // 测试连接：地址缺失/密钥缺失给出明确提示，不发请求。
  const noAddress = await models.testImageGen({});
  assert.equal(noAddress.ok, false);
  assert.match(noAddress.message, /服务地址/);
  const noKey = await models.testImageGen({ baseUrl: fixture.baseUrl });
  assert.equal(noKey.ok, false);
  assert.match(noKey.message, /密钥/);
  assert.equal(fixture.requests.length, 0);
  // 保存（默认模型 + 首次必填密钥）→ 状态与 imageGen() 一致；元数据文件不含密钥。
  await mkdir(join(data, 'private'), { recursive: true });
  const saved = await models.saveImageGen({ enabled: true, baseUrl: fixture.baseUrl, apiKey: fixture.apiKey });
  assert.deepEqual(saved, { enabled: true, baseUrl: fixture.baseUrl, model: 'gpt-image-2.5-flare',
    credentialId: 'image-gen-key', keyConfigured: true });
  const injected = await models.imageGen();
  assert.deepEqual(injected, { baseUrl: fixture.baseUrl, model: 'gpt-image-2.5-flare', apiKey: fixture.apiKey });
  const meta = await readFile(join(data, 'private', 'image-gen-settings.json'), 'utf8');
  assert.ok(!meta.includes(fixture.apiKey));
  const metaMode = (await stat(join(data, 'private', 'image-gen-settings.json'))).mode & 0o777;
  assert.equal(metaMode, 0o600);
  const credentialMode = (await stat(join(data, 'private', 'credentials.json'))).mode & 0o777;
  assert.equal(credentialMode, 0o600);
  // 测试连接留空密钥：用已保存密钥发 GET /models（零费用），成功且不泄露密钥。
  const probe = await models.testImageGen({ baseUrl: fixture.baseUrl });
  assert.equal(probe.ok, true);
  assert.equal(probe.status, 200);
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.requests[0].url, '/v1/models');
  assert.doesNotMatch(JSON.stringify(probe), new RegExp(fixture.apiKey));
  // 测试连接错误密钥：401 + 明确提示；模拟服务只收到认证失败请求，无生成调用。
  const bad = await models.testImageGen({ baseUrl: fixture.baseUrl, apiKey: 'deliberately-invalid-key' });
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 401);
  assert.match(bad.message, /认证失败/);
  assert.equal(fixture.requests.filter(request => request.url === '/v1/models').length, 2);
  assert.equal(fixture.requests.filter(request => request.url === '/v1/images/generations').length, 0);
  // 留空密钥改地址 → 拒绝保存（避免跨地址复用密钥）；已存密钥不动。
  await assert.rejects(models.saveImageGen({ enabled: true, baseUrl: fixture.baseUrl + '/other' }),
    /Missing or invalid Moos image API key/);
  assert.equal((await models.imageGen()).baseUrl, fixture.baseUrl);
  // 自定义模型 + 换密钥保存成功；聊天模型配置不受影响。
  const second = await models.saveImageGen({ enabled: true, baseUrl: fixture.baseUrl, model: 'gpt-image-2.5-sunburst',
    apiKey: fixture.apiKey });
  assert.equal(second.model, 'gpt-image-2.5-sunburst');
  assert.equal((await models.imageGen()).model, 'gpt-image-2.5-sunburst');
  assert.deepEqual(await models.list(), []);
  // 禁用 → imageGen() null 且状态保留地址便于恢复。
  const disabled = await models.saveImageGen({ enabled: false });
  assert.equal(disabled.enabled, false);
  assert.equal(await models.imageGen(), null);
  assert.equal(disabled.baseUrl, fixture.baseUrl);
  // 无效输入。
  await assert.rejects(models.saveImageGen({ enabled: true, baseUrl: 'ftp://x' }), /base URL/);
  await assert.rejects(models.saveImageGen({ enabled: true, baseUrl: fixture.baseUrl, model: 'a\nb' }), /model/);
  // 已保存配置与聊天模型共存：saveGroup 保留非 group-key 前缀的图片密钥。
  // 已保存配置与聊天模型共存：saveGroup 保留非 group-key 前缀的图片密钥。
  await models.saveGroup({ id: '', route: 'chat-main', name: '聊天主模型', baseUrl: fixture.baseUrl, api: 'openai-responses',
    models: [{ id: 'mock-glm' }], apiKey: 'sk-chat-test' });
  assert.deepEqual(await models.imageStatus(), { enabled: false, baseUrl: fixture.baseUrl,
    model: 'gpt-image-2.5-sunburst', credentialId: 'image-gen-key', keyConfigured: true });
  await models.saveImageGen({ enabled: true, baseUrl: fixture.baseUrl, apiKey: fixture.apiKey });
  await models.removeGroup('chat-main');
  assert.equal((await models.imageGen()).apiKey, fixture.apiKey, 'image key survives group removal');
});
