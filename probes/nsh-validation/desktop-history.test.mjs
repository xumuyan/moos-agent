import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Store } from '../../services/agent/store.mjs';
import { startDesktopHost } from './desktop-host.mjs';

function request(host, method, params = {}) {
  return host.call({ id: 'test', version: 1, method, params });
}

test('persisted messages are scoped, ordered, paginated and bounded to the process-start boundary', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'n01-message-page-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const start = () => startDesktopHost({ profileDir: root });
  const first = await start();
  const [projectId, other] = first.trustedProjects.map(p => p.id);
  const sessionId = request(first, 'sessions.list', { projectId }).result.sessions[0].id;
  const foreign = request(first, 'sessions.list', { projectId: other }).result.sessions[0].id;
  await first.close();

  const dbPath = join(root, 'data', 'desktop.sqlite');
  const store = new Store({ dbPath });
  const add = (conversationId, role, content) => store.addMessage({ conversationId, role, content });
  const expected = Array.from({ length: 25 }, (_, i) => add(sessionId, i % 2 ? 'assistant' : 'user', `消息${i}`));
  const hidden = add(sessionId, 'tool', 'TOOL_PRIVATE');
  const foreignMsg = add(foreign, 'user', 'FOREIGN_CHAT');
  const longText = '🟡'.repeat(4096);
  const long = add(sessionId, 'assistant', longText + 'TAIL');
  store.close();

  const host = await start();
  try {
    const scope = { projectId, sessionId };
    const read = (before = null) => request(host, 'sessions.history', { ...scope, before });
    const newest = read().result;
    assert.equal(newest.messages.length, 12);
    assert.equal(newest.projectId, projectId);
    assert.equal(newest.sessionId, sessionId);
    assert.deepEqual(newest.messages.at(-1), { id: long.id, role: 'assistant', text: longText, truncated: true });
    assert.equal(newest.before, newest.messages[0].id);
    assert.ok(Buffer.byteLength(JSON.stringify(newest)) < 512 * 1024);
    const middle = read(newest.before).result, oldest = read(middle.before).result;
    assert.equal(middle.messages.length, 12);
    assert.equal(oldest.messages.length, 2);
    assert.equal(oldest.before, null);
    assert.deepEqual([...oldest.messages, ...middle.messages, ...newest.messages], [...expected.map(m => ({
      id: m.id, role: m.role, text: m.content, truncated: false,
    })), newest.messages.at(-1)]);
    for (const cursor of [foreignMsg.id, hidden.id, 'unknown', 5, {}]) assert.equal(read(cursor).error.code, 'invalid_cursor');
    assert.equal(request(host, 'sessions.history', { projectId: other, sessionId, before: null }).error.code, 'not_found');
    assert.equal(request(host, 'sessions.history', { ...scope, before: null, path: dbPath }).error.code, 'invalid_request');
    const writer = new Store({ dbPath });
    let live;
    try { live = writer.addMessage({ conversationId: sessionId, role: 'user', content: 'LIVE_ONLY' }); }
    finally { writer.close(); }
    assert.deepEqual(read().result, newest);
    assert.equal(read(live.id).error.code, 'invalid_cursor');
  } finally { await host.close(); }
});

test('disposable Host does not provide the history RPC', async t => {
  const host = await startDesktopHost();
  t.after(() => host.close());
  assert.equal(request(host, 'sessions.history').error.code, 'unsupported_method');
});
