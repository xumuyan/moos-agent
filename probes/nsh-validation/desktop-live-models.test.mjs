import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, chmod, rm, link, symlink, writeFile, readFile, copyFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as wait } from 'node:timers/promises';
import { configParts, liveModelRoutes, loadLiveModels } from './desktop-live-models.mjs';
import { startDesktopHost } from './desktop-host.mjs';
import { serveDesktopPipe } from './desktop-host-stdio.mjs';
import { PassThrough } from 'node:stream';
import { createInterface } from 'node:readline';

const glm = 'glm-coding', relay = 'openai-relay';
const keys = { [glm]: 'synthetic-glm-key', [relay]: 'synthetic-relay-key' };
const profile = { contextWindow: 64000, maxTokens: 2048 };
const settings = (a = 'https://example.invalid/glm', b = 'https://example.invalid/relay') => ({
  [glm]: { ...profile, baseUrl: a, model: 'glm-test', api: 'openai-responses' },
  [relay]: { ...profile, baseUrl: b, model: 'relay-test', api: 'openai-completions' },
});

test('dual config is required, HTTPS-only, and fully separate from public catalog', () => {
  const result = liveModelRoutes(settings(), keys);
  assert.equal(result.catalog.defaultId, glm);
  assert.deepEqual(result.catalog.options.map(m => m.id), [glm, relay]);
  assert.equal(result.routes.get(glm).provider.service, 'glm');
  assert.equal(result.routes.get(relay).provider.service, undefined);
  assert.equal(result.routes.get(relay).apiKey, keys[relay]);
  assert.doesNotMatch(JSON.stringify(result.catalog), /synthetic-|example\.invalid|baseUrl|apiKey/);
  for (const endpoint of ['http://127.0.0.1:1', 'https://x.invalid/responses/', 'https://x.invalid/chat/completions',
    'https://x.invalid/v1?token=x', 'https://user:pass@x.invalid', 'file:///tmp']) {
    assert.throws(() => liveModelRoutes(settings(endpoint), keys), /invalid/i);
  }
  for (const bad of [{ [glm]: keys[glm] }, { ...keys, [relay]: 'bad\nkey' }, { ...keys, [relay]: '' }, { ...keys, extra: 'extra' }]) {
    assert.throws(() => liveModelRoutes(settings(), bad), /invalid/i);
  }
  assert.throws(() => liveModelRoutes({ ...settings(), [glm]: { ...settings()[glm], imageInput: true } }, keys), /invalid/i);
});

test('loader rejects missing, malformed, oversized, loose, hardlinked and symlinked configs', async t => {
  const root = await mkdtemp(join(tmpdir(), 'n01-model-config-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, ...configParts), credentials = join(dir, 'credentials.json');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const providers = join(dir, 'providers.json');
  await writeFile(providers, JSON.stringify(settings()), { mode: 0o600 });
  const rejected = () => assert.rejects(loadLiveModels(root), { message: 'Invalid isolated desktop model configuration' });
  await rejected();
  await writeFile(credentials, 'invalid synthetic-secret', { mode: 0o600 });
  await rejected();
  await writeFile(credentials, Buffer.alloc(17000, 32));
  await rejected();
  await writeFile(credentials, JSON.stringify(keys));
  assert.equal((await loadLiveModels(root)).catalog.defaultId, glm);
  await chmod(credentials, 0o644); await rejected(); await chmod(credentials, 0o600);
  await chmod(dir, 0o755); await rejected(); await chmod(dir, 0o700);
  const outside = join(root, 'private-file');
  await link(credentials, outside); await rejected();
  await rm(credentials); await symlink(outside, credentials); await rejected();
  await rm(dir, { recursive: true }); await symlink(root, dir); await rejected();
});

test('fixed live entry loads isolated files and advertises only public options; missing key never falls back', { timeout: 15000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'n01-live-entry-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = fileURLToPath(new URL('.', import.meta.url));
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  const probe = join(root, 'probes', 'nsh-validation'), config = join(root, ...configParts);
  await mkdir(probe, { recursive: true }); await mkdir(config, { recursive: true, mode: 0o700 });
  for (const part of ['packages', 'services']) await symlink(join(repo, part), join(root, part));
  for (const name of ['desktop-live-stdio.mjs', 'desktop-live-models.mjs', 'desktop-host-stdio.mjs',
    'desktop-host.mjs', 'desktop-model-fixture.mjs', 'desktop-statistics.mjs', 'desktop-profile.mjs']) {
    await copyFile(join(source, name), join(probe, name));
  }
  await writeFile(join(config, 'providers.json'), JSON.stringify(settings()), { mode: 0o600 });
  async function launch(configured) {
    const child = spawn(process.execPath, [join(probe, 'desktop-live-stdio.mjs')], {
      env: { PATH: '/usr/bin:/bin', TMPDIR: root, LANG: 'en_US.UTF-8' },
    });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    const closed = once(child, 'close');
    let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
    const output = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
    child.stdin.write('{"id":"list","version":1,"method":"projects.list","params":{}}\n');
    const line = await output.next();
    child.stdin.end();
    const [status] = await closed;
    assert.equal(status, configured ? 0 : 1);
    assert.doesNotMatch(stderr, /example\.invalid|synthetic-(?:glm|relay)-key/);
    if (!configured) {
      assert.ok(line.done); assert.match(stderr, /check private configuration and permissions/);
    } else {
      assert.deepEqual(JSON.parse(line.value).result.models, liveModelRoutes(settings(), keys).catalog);
      assert.doesNotMatch(line.value, /example\.invalid|synthetic-(?:glm|relay)-key/);
    }
  }
  await launch(false);
  await writeFile(join(config, 'credentials.json'), JSON.stringify(keys), { mode: 0o600 });
  await launch(true);
});

function streamResponse(res, text) {
  const part = { type: 'output_text', text, annotations: [] };
  const item = { id: 'msg_1', type: 'message', status: 'completed', role: 'assistant', content: [part] };
  const response = { id: 'resp_1', object: 'response', status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } };
  for (const event of [{ type: 'response.created', response: { ...response, output: [], status: 'in_progress' } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } },
    { type: 'response.content_part.added', content_index: 0, output_index: 0, item_id: item.id, part: { ...part, text: '' } },
    { type: 'response.output_text.delta', output_index: 0, item_id: item.id, content_index: 0, delta: text },
    { type: 'response.output_item.done', output_index: 0, item }, { type: 'response.completed', response }]) {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }
  res.end();
}
function streamChat(res, delta, finish = 'stop') {
  for (const choice of [{ delta, finish_reason: null }, { delta: {}, finish_reason: finish }]) {
    res.write(`data: ${JSON.stringify({ id: 'chatcmpl-test', object: 'chat.completion.chunk', choices: [{ index: 0, ...choice }] })}\n\n`);
  }
  res.end('data: [DONE]\n\n');
}

test('private pipe + real PI SDK: both protocols, same-session switch, write, auth failure, Stop and resend', { timeout: 30000 }, async t => {
  const calls = [], detached = [];
  let active, activeClosed, armed = false, toolSent = false;
  const server = createServer(async (req, res) => {
    if (req.url === '/glm/responses' || req.url === '/relay/chat/completions') {
      let text = '';
      for await (const chunk of req) text += chunk;
      const data = JSON.parse(text), isGlm = req.url === '/glm/responses';
      const last = data.input?.at(-1) ?? data.messages?.at(-1);
      const lastText = JSON.stringify(last);
      calls.push({ path: req.url, credentialMatched: req.headers.authorization === `Bearer ${keys[isGlm ? glm : relay]}`,
        model: data.model, history: text.includes('GLM synthetic text'), effort: data.reasoning?.effort });
      if (isGlm && lastText.includes('auth-check')) {
        res.writeHead(401); return res.end(`error intentionally echoes ${keys[glm]}`);
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (!isGlm && armed) {
        armed = false; res.write(': active\n\n'); res.once('close', () => { activeClosed = true; }); active = true;
      } else if (isGlm) streamResponse(res, 'GLM synthetic text');
      else if (lastText.includes('write-check') && !toolSent) {
        toolSent = true;
        streamChat(res, { tool_calls: [{ index: 0, id: 'call_write', type: 'function', function: {
          name: 'write', arguments: JSON.stringify({ path: 'dual.txt', content: 'isolated' }),
        } }] }, 'tool_calls');
      } else streamChat(res, { content: 'Relay synthetic text' });
    } else { detached.push(true); res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const liveModels = liveModelRoutes(settings(base + '/glm', base + '/relay'), keys, { testLoopback: true });
  const host = await startDesktopHost({ liveModels });
  const input = new PassThrough(), output = new PassThrough();
  const lines = createInterface({ input: output })[Symbol.asyncIterator]();
  const pipe = serveDesktopPipe({ input, output, start: async () => host });
  t.after(async () => { input.end(); await pipe; output.end(); });
  let sequence = 0;
  async function call(method, params = {}) {
    const id = `rpc-${++sequence}`;
    input.write(JSON.stringify({ id, version: 1, method, params }) + '\n');
    const reply = (await lines.next()).value;
    assert.doesNotMatch(reply, /synthetic-(?:glm|relay)-key|127\.0\.0\.1/);
    const payload = JSON.parse(reply);
    assert.equal(payload.id, id);
    return payload;
  }
  const listing = (await call('projects.list')).result;
  assert.deepEqual(listing.models, liveModels.catalog);
  const projectId = listing.projects[0].id;
  const sessionId = (await call('sessions.list', { projectId })).result.sessions[0].id;
  const scope = { projectId, sessionId };
  const submit = async (text, choice = {}) => {
    const result = await call('tasks.submit', { ...scope, requestId: `request-${sequence}`, text, ...choice });
    assert.equal(result.ok, true); return result.result.task.id;
  };
  async function drain(taskId) {
    let cursor = null; const events = [];
    for (let i = 0; i < 400; i++) {
      const { result } = await call('tasks.events', { ...scope, taskId, cursor, limit: 2 });
      cursor = result.cursor; events.push(...result.events);
      if (result.terminal && !result.hasMore) return { task: result.task, events };
      await wait(25);
    }
    assert.fail('Did not drain');
  }
  const textOf = result => result.events.filter(e => e.type === 'text_delta').map(e => e.payload.delta).join('');
  const first = await drain(await submit('glm-check'));
  assert.equal(first.task.status, 'succeeded'); assert.equal(textOf(first), 'GLM synthetic text');
  const second = await drain(await submit('write-check', { modelId: relay }));
  assert.equal(second.task.status, 'succeeded'); assert.equal(textOf(second), 'Relay synthetic text');
  assert.ok(second.events.some(e => e.type === 'tool_end' && e.payload.toolName === 'write' && !e.payload.isError));
  assert.equal(await readFile(join(host.trustedProjects[0].path, 'dual.txt'), 'utf8'), 'isolated');
  assert.ok(calls.some(entry => entry.path === '/relay/chat/completions' && entry.history));
  const bad = await drain(await submit('auth-check', { modelId: glm, reasoningEffort: 'high' }));
  assert.equal(bad.task.status, 'failed'); assert.equal(bad.task.errorCode, 'auth');
  armed = true;
  const pending = await submit('stop-check', { modelId: relay });
  for (let i = 0; !active && i < 100; i++) await wait(25);
  assert.ok(active);
  assert.ok((await call('tasks.cancel', { ...scope, taskId: pending })).ok);
  assert.equal((await drain(pending)).task.status, 'cancelled');
  for (let i = 0; !activeClosed && i < 100; i++) await wait(25);
  assert.ok(activeClosed);
  const after = await drain(await submit('send again', { modelId: relay }));
  assert.equal(after.task.status, 'succeeded'); assert.equal(textOf(after), 'Relay synthetic text');
  assert.deepEqual(calls.map(({ model, effort }) => [model, effort]), [
    ['glm-test', 'low'], ['relay-test', undefined], ['relay-test', undefined], ['glm-test', 'high'],
    ['relay-test', undefined], ['relay-test', undefined],
  ]);
  assert.equal(detached.length, 0); assert.ok(calls.every(e => e.credentialMatched));
  input.end(); assert.deepEqual(await pipe, { failed: false });
});
