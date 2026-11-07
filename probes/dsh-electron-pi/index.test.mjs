import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAdapter } from './index.mjs';

const human = text => ({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] });
const request = { sessionId: 'session-1', messages: [human('MOOS_FIXTURE_WRITE verified')] };
const collect = async stream => {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
};

async function adapter(t, run, override = {}) {
  const temporary = await mkdtemp(join(tmpdir(), 'moos-dsh-pi-test-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const workspace = await realpath(temporary);
  return createAdapter({
    workspace, run, dataDir: join(workspace, 'pi-data'),
    fixture: { baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'test-only' },
    getSession: () => ({ header: { cwd: workspace } }), ...override,
  });
}

test('routes real user text and stable session id and reports actual PI tool outcomes', async t => {
  const target = await adapter(t, async call => {
    assert.equal(call.task, 'MOOS_FIXTURE_WRITE verified');
    assert.equal(call.conversation.id, 'session-1');
    call.emit('tool_end', { toolName: 'write', isError: false, result: 'unpublished tool payload' });
    call.emit('text_delta', { delta: '完成 verified' });
    return { text: '完成 verified' };
  });
  const context = { ...human('synthetic context'), source: { kind: 'runtime-context' } };
  const events = await collect(target.stream({ ...request, messages: [...request.messages, context] }));
  assert.deepEqual(events.filter(event => event.type === 'text-delta').map(event => event.text),
    ['PI 工具 write：完成\n', '完成 verified']);
  assert.equal(events.at(-1).reason.kind, 'stop');
  assert.doesNotMatch(JSON.stringify(events), /unpublished tool payload/);
});

test('rejects a different workspace and arbitrary input before calling PI', async t => {
  const refuse = async () => assert.fail('must not start PI');
  const outOfScope = await adapter(t, refuse, { getSession: () => ({ header: { cwd: '/' } }) });
  assert.equal((await collect(outOfScope.stream(request))).at(-1).reason.kind, 'error');
  const target = await adapter(t, refuse);
  const input = { ...request, messages: [human('write arbitrary files')] };
  assert.equal((await collect(target.stream(input))).at(-1).reason.kind, 'error');
});

test('an auxiliary title request does not start a second PI task', async t => {
  const target = await adapter(t, async () => assert.fail('must not start PI'));
  const events = await collect(target.stream({ ...request, purpose: 'session-title' }));
  assert.equal(events.find(event => event.type === 'text-delta').text, 'Moos PI 验收');
});

test('passes cancellation to PI and does not report completion', async t => {
  const controller = new AbortController();
  const target = await adapter(t, async ({ signal }) => {
    controller.abort();
    signal.throwIfAborted();
    assert.fail('cancel must reach PI');
  });
  const events = await collect(target.stream({ ...request, signal: controller.signal }));
  assert.equal(events.at(-1).reason.kind, 'aborted');
});

test('sanitizes PI errors and keeps them distinct from a successful turn', async t => {
  const target = await adapter(t, async () => { throw new Error('unpublished upstream detail'); });
  const events = await collect(target.stream(request));
  assert.equal(events.at(-1).reason.kind, 'error');
  assert.doesNotMatch(JSON.stringify(events), /unpublished upstream detail/);
});
