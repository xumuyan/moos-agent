import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, readdir, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const load = () => import('./index.mjs');
const secret = 'upstream-secret-test-only';
async function fixture(t, handler) {
  const root = await mkdtemp(join(tmpdir(), 'pi-adapter-'));
  const project = { path: join(root, 'project') };
  await mkdir(project.path);
  const server = createServer(handler);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); server.close(); await rm(root, { recursive: true, force: true }); });
  return { root, project, dataDir: join(root, 'data'), conversation: { id: 'chat-1' },
    task: { text: 'Do the sample task' }, apiKey: secret,
    provider: { id: 'local-test', name: 'Local test', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'sample-model', api: 'openai-completions', contextWindow: 32000, maxTokens: 2048 } };
}
async function body(req) { let text = ''; for await (const c of req) text += c; return JSON.parse(text); }
function stream(res, delta, finish = 'stop') {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const d of delta) res.write(`data: ${JSON.stringify({ id: 'chatcmpl-test', object: 'chat.completion.chunk', choices: [{ index: 0, delta: d, finish_reason: null }] })}\n\n`);
  res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 } })}\n\ndata: [DONE]\n\n`);
}
async function files(dir) { const result = []; for (const entry of await readdir(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory()) result.push(...await files(path)); else result.push(path); } return result; }

test('real PI streams text, writes and runs bash without upstream credentials in tools/config', { timeout: 30000 }, async t => {
  let calls = 0; const requests = []; const events = [];
  const f = await fixture(t, async (req, res) => {
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, `Bearer ${secret}`);
    requests.push(await body(req));
    if (++calls === 1) stream(res, [{ role: 'assistant', content: 'Working…' }, { tool_calls: [{ index: 0, id: 'call_write', type: 'function', function: { name: 'write', arguments: JSON.stringify({ path: 'sample.txt', content: 'hello adapter' }) } }] }], 'tool_calls');
    else if (calls === 2) stream(res, [{ tool_calls: [{ index: 0, id: 'call_bash', type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command: 'env > tool-env.txt; printf harmless > bash-sample.txt' }) } }] }], 'tool_calls');
    else stream(res, [{ content: 'Done ' }, { content: 'successfully.' }]);
  });
  await writeFile(join(f.project.path, 'AGENTS.md'), 'PROJECT_RULE_MARKER: preserve this rule.');
  await writeFile(join(f.project.path, 'PLAN.md'), 'Plan');
  const { runPi } = await load();
  const result = await runPi({ ...f, emit: (name, data) => events.push([name, data]) });
  assert.equal(result.text, 'Working…Done successfully.');
  assert.equal(await readFile(join(f.project.path, 'sample.txt'), 'utf8'), 'hello adapter');
  assert.equal(await readFile(join(f.project.path, 'bash-sample.txt'), 'utf8'), 'harmless');
  assert.ok(events.some(([n, d]) => n === 'text_delta' && d.delta === 'Done '));
  assert.deepEqual(events.filter(([n]) => n === 'tool_start').map(([, d]) => d.toolName), ['write', 'bash']);
  assert.equal(events.filter(([n]) => n === 'tool_end').length, 2);
  assert.deepEqual(events.filter(([n]) => n === 'tool_end').map(([, d]) => d.toolName), ['write', 'bash']);
  assert.ok(events.some(([n]) => n === 'usage'));
  assert.ok(!events.some(([n]) => n.includes('thinking')));
  assert.match(JSON.stringify(requests[0]), /PROJECT_RULE_MARKER/);
  assert.match(JSON.stringify(requests[0]), /operatelog/);
  assert.deepEqual(requests[0].tools.map(x => x.function.name).sort(), ['bash', 'edit', 'find', 'grep', 'ls', 'read', 'write']);
  assert.ok(!(await readFile(join(f.project.path, 'tool-env.txt'), 'utf8')).includes(secret));
  for (const path of await files(f.dataDir)) assert.ok(!(await readFile(path, 'utf8')).includes(secret), path);
  const config = join(f.dataDir, f.conversation.id, 'agent', 'models.json');
  assert.equal((await stat(config)).mode & 0o777, 0o600);
  assert.equal((await stat(join(f.dataDir, f.conversation.id))).mode & 0o777, 0o700);
  assert.equal(calls, 3);
});

test('rejects invalid provider and traversal before starting PI', async t => {
  const f = await fixture(t, (_req, res) => res.end());
  const { runPi } = await load();
  for (const provider of [{ ...f.provider, baseUrl: 'http://example.com' }, { ...f.provider, model: '!touch bad' }, { ...f.provider, id: '../bad' }, { ...f.provider, maxTokens: -1 }, { ...f.provider, api: 'other' }]) {
    await assert.rejects(runPi({ ...f, provider }), /provider/i);
  }
  await assert.rejects(runPi({ ...f, conversation: { id: '../escape' } }), /conversation/i);
});

test('rejects existing session from a different cwd', async t => {
  const f = await fixture(t, (_req, res) => res.end());
  await mkdir(join(f.dataDir, f.conversation.id), { recursive: true });
  await writeFile(join(f.dataDir, f.conversation.id, 'session.jsonl'), JSON.stringify({ type: 'session', cwd: f.root }) + '\n');
  const { runPi } = await load();
  await assert.rejects(runPi(f), /session.*project|cwd/i);
});

test('cancels an active upstream stream and closes the per-run proxy', { timeout: 15000 }, async t => {
  let started; const active = new Promise(r => { started = r; });
  let closed; const upstreamClosed = new Promise(r => { closed = r; });
  const f = await fixture(t, async (req, res) => {
    await body(req); res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(': waiting\n\n');
    res.on('close', closed); started();
  });
  const { runPi } = await load(); const controller = new AbortController();
  const promise = runPi({ ...f, signal: controller.signal });
  const rejected = assert.rejects(promise, /abort/i);
  await active;
  const config = JSON.parse(await readFile(join(f.dataDir, f.conversation.id, 'agent', 'models.json'), 'utf8'));
  const proxy = config.providers[f.provider.id].baseUrl;
  controller.abort(); await rejected; await upstreamClosed;
  await assert.rejects(fetch(proxy + '/chat/completions'));
});

test('proxy enforces authentication, exact paths, body cap and no CORS', { timeout: 20000 }, async t => {
  let started; const active = new Promise(r => { started = r; }); let count = 0;
  const f = await fixture(t, async (req, res) => { count++; await body(req); res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(': wait\n\n'); started(); });
  const { runPi } = await load(); const c = new AbortController();
  const result = runPi({ ...f, signal: c.signal }); const rejected = assert.rejects(result, /abort/i);
  t.after(async () => { c.abort(); await rejected; });
  await active;
  const config = JSON.parse(await readFile(join(f.dataDir, f.conversation.id, 'agent', 'models.json'), 'utf8'));
  const { baseUrl, apiKey } = config.providers[f.provider.id];
  const headers = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' };
  const unauth = await fetch(baseUrl + '/chat/completions', { method: 'POST', body: '{}' });
  assert.equal(unauth.status, 401); assert.equal(unauth.headers.get('access-control-allow-origin'), null);
  for (const path of ['/responses', '/chat/completions?x=1', '/other']) assert.equal((await fetch(baseUrl + path, { method: 'POST', headers, body: '{}' })).status, 404);
  const endpoint = baseUrl + '/chat/completions';
  const oversized = 'x'.repeat(8 * 1024 * 1024 + 1);
  const declared = await fetch(endpoint, { method: 'POST', headers, body: oversized });
  assert.equal(declared.status, 413);
  assert.notEqual(declared.headers.get('connection'), 'close');
  await declared.text();
  const chunked = await fetch(endpoint, {
    method: 'POST', headers, duplex: 'half',
    body: (async function* () { yield Buffer.from(oversized); yield Buffer.from('tail'); })(),
  });
  assert.equal(chunked.status, 413);
  await chunked.text();
  assert.equal(count, 1);
  c.abort(); await rejected;
});

test('session header with nonexistent cwd is rejected rather than silently reused', async t => {
  const f = await fixture(t, (_req, res) => res.end());
  await mkdir(join(f.dataDir, f.conversation.id), { recursive: true });
  await writeFile(join(f.dataDir, f.conversation.id, 'session.jsonl'), JSON.stringify({ type: 'session', cwd: join(f.root, 'missing') }) + '\n');
  const { runPi } = await load();
  await assert.rejects(runPi({ ...f, task: { text: 'test', timeoutMs: 100 } }), /session.*project|cwd/i);
});

test('owned PI exits even when adapter host is forcibly killed', { timeout: 15000 }, async t => {
  let started; const active = new Promise(r => { started = r; });
  const f = await fixture(t, async (req, res) => { await body(req); res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(': waiting\n\n'); started(); });
  const code = `import {runPi} from ${JSON.stringify(new URL('./index.mjs', import.meta.url).href)}; await runPi(${JSON.stringify(f)});`;
  const host = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: 'ignore' });
  t.after(() => host.kill('SIGKILL'));
  await active;
  const { execFileSync } = await import('node:child_process');
  const children = execFileSync('pgrep', ['-P', String(host.pid)], { encoding: 'utf8' }).trim().split('\n').map(Number);
  assert.ok(children.length > 0);
  host.kill('SIGKILL');
  const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
  for (let i = 0; i < 40 && children.some(alive); i++) await delay(100);
  const survivors = children.filter(alive);
  for (const pid of survivors) process.kill(pid, 'SIGKILL');
  assert.deepEqual(survivors, []);
});

test('real PI responses API streams through the strict responses route', { timeout: 15000 }, async t => {
  const f = await fixture(t, async (req, res) => {
    assert.equal(req.url, '/v1/responses'); assert.equal(req.headers.authorization, `Bearer ${secret}`); await body(req);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const item = { id: 'msg_1', type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: 'Responses work', annotations: [] }] };
    const response = { id: 'resp_1', object: 'response', status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } };
    for (const event of [{ type: 'response.created', response: { ...response, status: 'in_progress', output: [] } }, { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } }, { type: 'response.content_part.added', item_id: 'msg_1', output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } }, { type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, content_index: 0, delta: 'Responses work' }, { type: 'response.output_item.done', output_index: 0, item }, { type: 'response.completed', response }]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    res.end();
  });
  const { runPi } = await load();
  assert.deepEqual(await runPi({ ...f, provider: { ...f.provider, api: 'openai-responses' } }), { text: 'Responses work' });
});

test('independent projects run concurrently; same project cannot overlap and timeout cancels upstream', { timeout: 25000 }, async t => {
  let count = 0; let started; const both = new Promise(r => { started = r; });
  const f = await fixture(t, async (req, res) => { await body(req); res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(': wait\n\n'); if (++count === 2) started(); });
  const { runPi } = await load(); const c = new AbortController();
  const a = runPi({ ...f, signal: c.signal }); const ar = assert.rejects(a, /abort/i);
  const project = { path: join(f.root, 'other') }; await mkdir(project.path);
  const b = runPi({ ...f, project, conversation: { id: 'chat-2' }, task: { text: 'test', timeoutMs: 10000 } }); const br = assert.rejects(b, /abort/i);
  await both;
  await assert.rejects(runPi({ ...f, conversation: { id: 'chat-3' } }), /already running/i);
  c.abort(); await ar; await br;
  assert.equal(count, 2);
});

test('conversation session resumes previous messages with a fresh authenticated proxy', { timeout: 15000 }, async t => {
  const requests = [];
  const f = await fixture(t, async (req, res) => { requests.push(await body(req)); stream(res, [{ content: 'remembered' }]); });
  const { runPi } = await load();
  await runPi({ ...f, task: { text: 'first-turn-marker' } });
  await runPi({ ...f, task: { text: 'second-turn-marker' } });
  assert.equal(requests.length, 2);
  assert.match(JSON.stringify(requests[1].messages), /first-turn-marker/);
  assert.match(JSON.stringify(requests[1].messages), /second-turn-marker/);
});

test('cancelling a running bash tool terminates its owned child even after slow startup', { timeout: 30000 }, async t => {
  const f = await fixture(t, async (req, res) => { await body(req); await delay(6000); stream(res, [{ tool_calls: [{ index: 0, id: 'call_wait', type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command: 'sleep 60 & child=$!; printf "%s" "$child" > owned.pid; printf started; wait "$child"', timeout: 90 }) } }] }], 'tool_calls'); });
  const { runPi } = await load(); const c = new AbortController(); const events = [];
  // Observe rejection immediately without creating a second, unattended rejecting assertion.
  const outcome = runPi({ ...f, signal: c.signal, emit: (name, data) => events.push([name, data]) })
    .then(value => ({ value }), error => ({ error }));
  const abort = () => c.abort();
  t.signal.addEventListener('abort', abort, { once: true });
  const readPid = async () => {
    try { return Number(await readFile(join(f.project.path, 'owned.pid'), 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  };
  const alive = pid => {
    try { process.kill(pid, 0); return true; }
    catch (e) { if (e.code !== 'ESRCH') throw e; return false; }
  };
  let pid;
  const ready = (async () => {
    // The test's overall deadline bounds startup; tool_start alone precedes the child.
    while (!c.signal.aborted) {
      pid = await readPid();
      if (Number.isSafeInteger(pid) && pid > 1) return pid;
      await delay(50, undefined, { signal: c.signal });
    }
    throw new Error('Cancelled before bash child became ready');
  })();
  try {
    await Promise.race([ready, outcome.then(({ error }) => {
      throw error ?? new Error('PI completed before bash child became ready');
    })]);
    assert.ok(events.some(([name, data]) => name === 'tool_start' && data.toolName === 'bash'));
    // PI may batch bash updates; cancellation must still dispose its process group.
    c.abort();
    const { error } = await outcome;
    assert.ok(error, 'Cancellation must reject the run');
    assert.match(error.message, /abort/i);
    for (let i = 0; i < 40 && alive(pid); i++) await delay(50);
    assert.equal(alive(pid), false);
  } finally {
    c.abort();
    await outcome;
    await ready.catch(() => {});
    t.signal.removeEventListener('abort', abort);
    // Read again after shutdown in case startup wrote the PID while readiness failed.
    pid = await readPid();
    if (Number.isSafeInteger(pid) && pid > 1 && alive(pid)) process.kill(pid, 'SIGKILL');
  }
});

test('provider failures are not reported as prompt success', { timeout: 20000 }, async t => {
  const f = await fixture(t, async (req, res) => { await body(req); res.writeHead(401); res.end(JSON.stringify({ error: { message: 'bad credential ' + secret } })); });
  const { runPi } = await load();
  await assert.rejects(runPi(f), error => /failed|error/i.test(error.message) && !error.message.includes(secret));
  for (const path of await files(f.dataDir)) assert.ok(!(await readFile(path, 'utf8')).includes(secret));
});

test('PI SDK compacts a rejected long history once and continues without replaying prior turns', { timeout: 30000 }, async t => {
  const { runPiSdk } = await import('../pi-runtime/sdk-runtime.mjs');
  let requests = 0;
  const events = [];
  const f = await fixture(t, async (req, res) => {
    const input = await body(req);
    requests++;
    if (requests === 4) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'context_length_exceeded', message: secret } }));
    } else if (requests === 5) {
      assert.equal(input.tools?.length ?? 0, 0);
      stream(res, [{ content: 'Retained work summary' }]);
    } else if (requests === 6) {
      assert.match(JSON.stringify(input.messages), /Retained work summary/);
      assert.match(JSON.stringify(input.messages), /Next instruction/);
      assert.doesNotMatch(JSON.stringify(input.messages), /Earliest turn marker/);
      stream(res, [{ content: 'Resumed' }]);
    } else {
      stream(res, [{ content: 'Saved' }]);
    }
  });
  for (const marker of ['Earliest turn marker', 'Middle turn', 'Latest turn']) {
    await runPiSdk({ ...f, task: { text: marker + ' ' + 'a'.repeat(40000) } });
  }
  const result = await runPiSdk({ ...f, task: { text: 'Next instruction' },
    emit: (type, payload) => events.push({ type, payload }) });
  assert.equal(result.text, 'Resumed');
  assert.equal(requests, 6);
  assert.ok(events.some(event => event.type === 'usage' && event.payload.kind === 'compaction'));
  assert.doesNotMatch(JSON.stringify(events), new RegExp(secret));
});

test('PI SDK reports a context limit when there is no older history to compact', async t => {
  const { runPiSdk } = await import('../pi-runtime/sdk-runtime.mjs');
  const f = await fixture(t, async (req, res) => {
    await body(req);
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'context_length_exceeded', message: secret } }));
  });
  await assert.rejects(runPiSdk(f), { code: 'context_limit' });
});

test('the long-context proxy forwards a JSON body larger than the former 2 MiB limit', async t => {
  const f = await fixture(t, async (req, res) => {
    const input = await body(req);
    assert.equal(input.content.length, 2 * 1024 * 1024);
    res.end('{}');
  });
  const { proxyFor } = await load();
  const proxy = await proxyFor(f.provider, f.provider.baseUrl, f.apiKey);
  t.after(() => proxy.close());
  const response = await fetch(proxy.baseUrl + '/chat/completions', {
    method: 'POST', headers: { authorization: 'Bearer ' + proxy.token },
    body: JSON.stringify({ content: 'x'.repeat(2 * 1024 * 1024) }),
  });
  assert.equal(response.status, 200);
  await response.text();
});
