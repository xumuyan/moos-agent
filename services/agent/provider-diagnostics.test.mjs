import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createController } from './controller.mjs';
import { startFixture } from './fixture.mjs';

const key = 'diagnostic-test-secret';
const chat = { choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }] };
const completed = { status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'OK' }] }] };
async function setup(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const dataDir = await mkdtemp(join(tmpdir(), 'moos-diagnostics-'));
  const controller = await createController({ dataDir, run: () => assert.fail('Diagnostics must not run tasks') });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await controller.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const provider = { baseUrl: `http://127.0.0.1:${server.address().port}/nested/v1/`, api: 'openai-completions', model: 'unsaved-model' };
  return { controller, dataDir, provider, request: (method = 'test_provider', overrides = {}) => controller.request(method, { provider, apiKey: key, ...overrides }) };
}
function json(res, status, body) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); }
function result(value, code) {
  assert.equal(value.code, code);
  assert.equal(value.ok, code === 'ok');
  assert.equal(typeof value.message, 'string');
  assert.match(value.message, /[\u4e00-\u9fff]/);
  assert(Number.isFinite(value.elapsedMs) && value.elapsedMs >= 0);
  assert.equal(JSON.stringify(value).includes(key), false);
  assert.equal(JSON.stringify(value).includes('UPSTREAM_PRIVATE'), false);
}

for (const api of ['openai-completions', 'openai-responses']) {
  test(`unsaved ${api} diagnostic appends path, uses bounded nonstream text and never persists`, async t => {
    let seen;
    const f = await setup(t, async (req, res) => {
      let body = ''; for await (const chunk of req) body += chunk;
      seen = { url: req.url, method: req.method, auth: req.headers.authorization, body: JSON.parse(body) };
      json(res, 200, api === 'openai-completions' ? chat : completed);
    });
    await f.controller.request('save_provider', { provider: { ...f.provider, id: 'saved', model: 'saved-model' } });
    const before = await f.controller.request('snapshot');
    const file = await readFile(join(f.dataDir, 'providers.json'), 'utf8');
    result(await f.request('test_provider', { provider: { ...f.provider, api } }), 'ok');
    assert.equal(seen.url, `/nested/v1/${api === 'openai-completions' ? 'chat/completions' : 'responses'}`);
    assert.equal(seen.auth, `Bearer ${key}`);
    assert.equal(seen.method, 'POST');
    assert.deepEqual(seen.body, api === 'openai-completions'
      ? { model: 'unsaved-model', messages: [{ role: 'user', content: 'Reply OK' }], max_tokens: 16, stream: false }
      : { model: 'unsaved-model', input: 'Reply OK', max_output_tokens: 16, stream: false });
    assert.deepEqual(await f.controller.request('snapshot'), before);
    assert.equal(await readFile(join(f.dataDir, 'providers.json'), 'utf8'), file);
  });
}

test('GLM reasoning diagnostics leave room for a visible answer while staying bounded', async t => {
  let payload;
  const f = await setup(t, async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    payload = JSON.parse(body);
    json(res, 200, chat);
  });
  result(await f.request('test_provider', { provider: { ...f.provider, service: 'glm', model: 'glm-5.3' } }), 'ok');
  assert.equal(payload.reasoning_effort, 'low');
  assert.equal(payload.max_tokens, 256);
  assert.equal(payload.stream, false);
});

test('list requires neither model, id nor name, deduplicates and bounds IDs and scrubs exact keys', async t => {
  const f = await setup(t, (req, res) => {
    assert.equal(req.method, 'GET'); assert.equal(req.url, '/nested/v1/models');
    json(res, 200, { data: [{ id: 'valid' }, { id: 'valid' }, { id: `prefix-${key}-suffix` }, { id: 'x'.repeat(201) }, { id: '' }, { id: 4 }, ...Array.from({ length: 600 }, (_, i) => ({ id: `model-${i}` }))] });
  });
  const value = await f.request('list_models', { provider: { baseUrl: f.provider.baseUrl, api: f.provider.api } });
  result(value, 'ok');
  assert.equal(value.models.length, 500);
  assert.equal(value.models[0], 'valid');
  assert(value.models.every(id => id.length <= 200));
  assert.equal(new Set(value.models).size, value.models.length);
});

for (const [label, patch, code] of [
  ['missing key', { apiKey: undefined }, 'missing_key'],
  ['missing provider', { provider: undefined }, 'invalid_config'],
  ['missing test model', { model: undefined }, 'invalid_config'],
  ['empty model', { model: ' ' }, 'invalid_config'],
  ['unsupported API', { api: 'other' }, 'invalid_config'],
  ['public HTTP', { baseUrl: 'http://example.com/v1' }, 'invalid_config'],
  ['userinfo', { baseUrl: 'https://user:pass@example.com/v1' }, 'invalid_config'],
  ['query', { baseUrl: 'https://example.com/v1?key=x' }, 'invalid_config'],
  ['hash', { baseUrl: 'https://example.com/v1#x' }, 'invalid_config'],
  ['invalid URL', { baseUrl: 'not-a-url' }, 'invalid_config'],
]) {
  test(`validates ${label} with a structured result before network`, async t => {
    const f = await setup(t, () => assert.fail('Invalid config must not contact server'));
    const overrides = Object.hasOwn(patch, 'apiKey') || Object.hasOwn(patch, 'provider') ? patch : { provider: { ...f.provider, ...patch } };
    result(await f.request('test_provider', overrides), code);
  });
}

for (const [status, error, code] of [
  [401, {}, 'auth'], [403, {}, 'forbidden'], [404, {}, 'endpoint_unsupported'],
  [405, {}, 'endpoint_unsupported'], [429, {}, 'rate_limit'],
  [429, { code: 'insufficient_quota' }, 'quota'],
  [400, { type: 'insufficient_quota' }, 'quota'],
  [404, { code: 'model_not_found' }, 'model_not_found'],
  [400, { code: 'unsupported_endpoint' }, 'endpoint_unsupported'],
  [400, { code: 'invalid_api_key' }, 'auth'],
  [400, { type: 'rate_limit_exceeded' }, 'rate_limit'],
  [500, {}, 'protocol'], [400, { code: { arbitrary: key } }, 'protocol'],
]) {
  test(`HTTP ${status} ${JSON.stringify(error)} maps to ${code} without provider text`, async t => {
    const f = await setup(t, (_, res) => json(res, status, { error: { ...error, message: `UPSTREAM_PRIVATE ${key}` } }));
    result(await f.request(), code);
  });
}

test('GLM diagnostics distinguish Coding Plan limits, model access and credential scope', async t => {
  let code;
  const f = await setup(t, (_, res) => json(res, 429, { error: { code, message: `UPSTREAM_PRIVATE ${key}` } }));
  const provider = { ...f.provider, service: 'glm' };
  for (const [upstream, expected] of [
    ['1113', 'quota'], [1308, 'quota'], ['1309', 'quota'], ['1310', 'quota'], ['1314', 'quota'],
    ['1316', 'quota'], ['1321', 'quota'], ['1302', 'rate_limit'], ['1305', 'rate_limit'],
    ['1311', 'model_not_found'], ['1315', 'auth'], ['9999', 'rate_limit'],
  ]) {
    code = upstream;
    result(await f.request('test_provider', { provider }), expected);
  }
  code = '1310';
  result(await f.request(), 'rate_limit');
});

for (const [label, body, api] of [
  ['failed response', { status: 'failed', error: { code: 'insufficient_quota', message: key } }, 'openai-responses'],
  ['incomplete response', { ...completed, status: 'incomplete' }, 'openai-responses'],
  ['empty response', { status: 'completed', output: [] }, 'openai-responses'],
  ['user response', { ...completed, output: [{ ...completed.output[0], role: 'user' }] }, 'openai-responses'],
  ['empty chat', { choices: [] }, 'openai-completions'],
  ['unfinished chat', { choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: null }] }, 'openai-completions'],
  ['missing chat finish', { choices: [{ message: { role: 'assistant', content: 'OK' } }] }, 'openai-completions'],
  ['unfinished message', { ...completed, output: [{ ...completed.output[0], status: 'in_progress' }] }, 'openai-responses'],
  ['user chat', { choices: [{ message: { role: 'user', content: 'OK' } }] }, 'openai-completions'],
  ['tool chat', { choices: [{ message: { role: 'assistant', content: null, tool_calls: [] } }] }, 'openai-completions'],
  ['error 200', { error: { message: key } }, 'openai-completions'],
]) {
  test(`HTTP 200 ${label} is not success`, async t => {
    const f = await setup(t, (_, res) => json(res, 200, body));
    const value = await f.request('test_provider', { provider: { ...f.provider, api } });
    result(value, label === 'failed response' ? 'quota' : 'protocol');
  });
}

for (const body of [{}, { data: {} }, { data: ['not-an-id-object'] }]) {
  test(`malformed model list ${JSON.stringify(body)} is protocol failure`, async t => {
    const f = await setup(t, (_, res) => json(res, 200, body));
    result(await f.request('list_models'), 'protocol');
  });
}

test('empty OpenAI list is valid; unsupported list does not prevent connection test', async t => {
  let supported = false;
  const f = await setup(t, (req, res) => req.method === 'GET'
    ? json(res, supported ? 200 : 404, supported ? { data: [] } : {}) : json(res, 200, chat));
  result(await f.request('list_models'), 'endpoint_unsupported');
  result(await f.request(), 'ok');
  supported = true;
  const value = await f.request('list_models'); result(value, 'ok'); assert.deepEqual(value.models, []);
});

test('diagnostic results preserve only the numeric HTTP status, including non-JSON errors', async t => {
  let status = 401;
  const f = await setup(t, (_, res) => { res.writeHead(status); res.end(`UPSTREAM_PRIVATE ${key}`); });
  let value = await f.request(); result(value, 'auth'); assert.equal(value.status, 401);
  status = 200;
  value = await f.request(); result(value, 'protocol'); assert.equal(value.status, 200);
});

test('malformed JSON is a safe protocol failure', async t => {
  const f = await setup(t, (_, res) => res.end(`UPSTREAM_PRIVATE ${key}`));
  result(await f.request(), 'protocol');
});

for (const declared of [false, true]) {
  test(`response limit rejects ${declared ? 'declared' : 'chunked'} bodies over 1 MiB`, async t => {
    const f = await setup(t, (_, res) => {
      if (declared) res.setHeader('content-length', 2 * 1024 * 1024);
      res.end('x'.repeat(1024 * 1024 + 1));
    });
    result(await f.request(), 'protocol');
  });
}

test('redirect is never followed or forwarded a credential', async t => {
  let redirected = 0;
  const f = await setup(t, (req, res) => {
    if (req.url === '/steal') { redirected++; return json(res, 200, chat); }
    res.writeHead(307, { location: '/steal' }); res.end();
  });
  result(await f.request(), 'endpoint_unsupported');
  assert.equal(redirected, 0);
});

test('network disconnect returns structured network diagnostics', async t => {
  const f = await setup(t, req => req.socket.destroy());
  result(await f.request(), 'network');
});

test('deadline covers a stalled body and completes within the host timeout', { timeout: 12000 }, async t => {
  const f = await setup(t, (_, res) => { res.writeHead(200); res.write('{'); });
  const started = performance.now();
  result(await f.request(), 'timeout');
  assert(performance.now() - started < 9500);
});

test('browser bridge diagnoses only its fixture and rejects foreign URLs and keys', { timeout: 15000 }, async t => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./dev-server.mjs', import.meta.url)), '--fixture', '--port=0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  t.after(async () => {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; }
    const directory = /temporary projects: (.+)/.exec(output)?.[1];
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => { output += chunk; if (output.includes('bridge ready')) resolve(); });
    child.once('exit', () => reject(new Error(`Bridge exited: ${errors}`)));
  });
  const request = async (method, params = {}) => {
    const port = /ready on 127\.0\.0\.1:(\d+)/.exec(output)[1];
    const response = await fetch(`http://127.0.0.1:${port}/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
    return { status: response.status, body: await response.json() };
  };
  const bridgePort = /ready on 127\.0\.0\.1:(\d+)/.exec(output)[1];
  const malformed = await fetch(`http://127.0.0.1:${bridgePort}/api/test_provider`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"apiKey":"real-secret"}' + 'invalid' });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.text()).includes('real-secret'), false);
  const before = (await request('snapshot')).body;
  const provider = before.providers[0];
  for (const api of ['openai-completions', 'openai-responses']) {
    for (const method of ['list_models', 'test_provider']) {
      const value = await request(method, { provider: { ...provider, api } });
      assert.equal(value.status, 200); result(value.body, 'ok');
    }
  }
  for (const patch of [{ provider: { ...provider, baseUrl: 'https://example.com/v1' } }, { apiKey: 'real-secret' }, { apiKey: '' }]) {
    const value = await request('test_provider', { provider, ...patch });
    assert.equal(value.status, 400);
    assert.equal(JSON.stringify(value.body).includes('real-secret'), false);
  }
  const explicit = await request('test_provider', { provider, apiKey: 'moos-local-fixture-test-only' });
  assert.equal(explicit.status, 200); result(explicit.body, 'ok');
  assert.deepEqual((await request('snapshot')).body, before);
});

test('local fixture supports list and static diagnostic probes for both protocols', async t => {
  const fixture = await startFixture(); t.after(() => fixture.close());
  const f = await setup(t, () => assert.fail('Wrong fixture'));
  const provider = { baseUrl: fixture.baseUrl, api: 'openai-completions', model: 'fixture' };
  const params = { provider, apiKey: fixture.apiKey };
  const models = await f.controller.request('list_models', params); result(models, 'ok'); assert.deepEqual(models.models, ['fixture']);
  result(await f.controller.request('test_provider', params), 'ok');
  result(await f.controller.request('test_provider', { ...params, provider: { ...provider, api: 'openai-responses' } }), 'ok');
});
