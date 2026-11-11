import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, chmod, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPiSdk } from './sdk-runtime.mjs';
import { SHARED_QUEUE } from './desktop-tools.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('two real PI SDK sessions hold the desktop across model waits and release after verification or missing end', { timeout: 30000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'moos-desktop-sdk-'));
  const trace = join(root, 'trace'), events = [], ids = {}, requests = {};
  const aObserved = deferred(), bQueued = deferred();
  const focus = { pid: 42, bundleId: 'com.example.fixture', windowId: 7,
    window: { x: 0, y: 0, width: 800, height: 600 }, element: { x: 10, y: 10, width: 100, height: 30 }, role: 'AXTextField', path: [0] };
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGyoAAAAASUVORK5CYII=';
  for (const name of ['a', 'b', 'unfinished']) {
    await mkdir(join(root, name));
    const helper = join(root, name, 'helper.mjs');
    await writeFile(helper, `#!${process.execPath}\nimport { writeFileSync, appendFileSync } from 'node:fs';
const mode = process.argv[2], arg = k => process.argv[process.argv.indexOf(k)+1];
const focus = ${JSON.stringify(focus)};
const out = v => { console.log(JSON.stringify(v)); process.exit(0); };
appendFileSync(${JSON.stringify(trace)}, ${JSON.stringify(name + ':')} + mode + '\\n');
if (mode === 'focus') out({ focus });
if (mode === 'screenshot') { writeFileSync(arg('--out'), Buffer.from('${png}', 'base64')); out({status:'ok',scope:'window',imageWidth:1,imageHeight:1}); }
if (mode === 'key' || mode === 'type') {
 if (JSON.stringify(focus)!==arg('--expect-focus')) { console.log(JSON.stringify({status:'failed',reason:'focus-changed'})); process.exit(5); }
 out({status:'ok',keycode:37,characters:12});
}
process.exit(2);\n`);
    await chmod(helper, 0o755);
  }
  const server = createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const request = JSON.parse(raw), name = request.model;
      const index = requests[name] ?? 0; requests[name] = index + 1;
      // A is between observation and the next model tool call while B queues.
      if (name === 'a' && index === 2) await bQueued.promise;
      const state = ids[name] ?? {};
      const steps = name === 'unfinished' ? [['desktop_begin', {}]] : [
        ['desktop_begin', {}],
        ['desktop_screenshot', { transactionId: state.transactionId, scope: 'window', windowId: 7 }],
        ['desktop_key', { ...state, key: 'l', modifiers: ['cmd'] }],
        ['desktop_screenshot', { transactionId: state.transactionId, scope: 'window', windowId: 7 }],
        ['desktop_type', { ...state, text: 'fixture-only' }],
        ['desktop_screenshot', { transactionId: state.transactionId, scope: 'window', windowId: 7 }],
        ['desktop_end', { ...state, action: 'verify' }],
      ];
      const step = steps[index];
      assert.equal(request.tools.filter(t => t.function.name.startsWith('desktop_')).length, 11);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const delta = step ? { tool_calls: [{ index: 0, id: `${name}_${index}`, type: 'function', function: { name: step[0], arguments: JSON.stringify(step[1]) } }] } : { content: `${name}_DONE` };
      for (const [data, finish] of [[delta, null], [{}, step ? 'tool_calls' : 'stop']]) {
        res.write('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: data, finish_reason: finish }] }) + '\n\n');
      }
      res.end('data: [DONE]\n\n');
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); server.close(); await rm(root, { recursive: true, force: true }); });
  function run(name) {
    return runPiSdk({ task: { text: 'Execute the synthetic desktop sequence only.', timeoutMs: 600000 },
      project: { path: join(root, name) }, conversation: { id: name }, dataDir: join(root, 'sessions'),
      apiKey: 'synthetic-local-only', imageGen: null, desktop: { helperPath: join(root, name, 'helper.mjs') },
      emit(type, event) {
        events.push({ name, type, ...event });
        if (type === 'desktop_action' && name === 'b' && event.phase === 'queued') bQueued.resolve();
        if (type === 'tool_end' && !event.isError) {
          if (event.toolName === 'desktop_begin') ids[name] = { transactionId: event.result.details.transactionId };
          if (event.toolName === 'desktop_screenshot') {
            ids[name].observationId = event.result.details.observationId;
            if (name === 'a') aObserved.resolve();
          }
        }
      },
      provider: { id: 'fixture', name: 'Local fixture', model: name, api: 'openai-completions', imageInput: true,
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`, contextWindow: 32000, maxTokens: 2048 },
    });
  }
  const first = run('a'); await aObserved.promise;
  const second = run('b');
  assert.deepEqual((await Promise.all([first, second])).map(r => r.text), ['a_DONE', 'b_DONE']);
  assert.equal(events.filter(e => e.type === 'tool_end' && e.isError).length, 0);
  const lines = (await readFile(trace, 'utf8')).trim().split('\n');
  const firstB = lines.findIndex(l => l.startsWith('b:'));
  assert.ok(firstB > 0 && lines.slice(firstB).every(l => l.startsWith('b:')), 'B cannot run between A observe/input/verify');
  assert.equal(lines.filter(l => l.endsWith(':screenshot')).length, 8);
  assert.equal(SHARED_QUEUE.status().locked, false);
  assert.equal((await run('unfinished')).text, 'unfinished_DONE');
  assert.equal(SHARED_QUEUE.status().locked, false, 'SDK finally releases a lease even when model omits desktop_end');
  assert.deepEqual(events.filter(e => e.name === 'unfinished' && e.type === 'desktop_action').map(e => e.phase), ['running', 'cancelled']);
});
