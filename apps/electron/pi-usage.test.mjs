import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Store } from '../../services/agent/store.mjs';
import { createPiUsageReader } from './pi-usage.mjs';

test('usage totals include every recorded request while context follows only the latest request in its session', async t => {
  const root = await mkdtemp(join(tmpdir(), 'moos-pi-usage-'));
  const dbPath = join(root, 'test.sqlite');
  const store = new Store({ dbPath });
  const usage = createPiUsageReader(dbPath);
  t.after(async () => {
    usage.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  });

  assert.deepEqual(usage.read(null), { requests: 0, totalTokens: null, inputTokens: null, outputTokens: null,
    cacheReadTokens: null, cacheWriteTokens: null });
  assert.equal(usage.read('first'), null);
  assert.throws(() => usage.read('../../data'));
  const project = await store.addProject(root);
  function start(sessionId) {
    const conversation = store.createConversation(project.id);
    store.setSetting('dsh-session:' + sessionId, conversation.id);
    return store.createTask({ conversationId: conversation.id, message: 'work' }).id;
  }

  const first = start('first');
  const other = start('other');
  store.appendEvent(first, 'usage', { totalTokens: 25, inputTokens: 12, outputTokens: 5,
    cacheReadTokens: 8, cacheWriteTokens: null }); // older record without a window
  assert.deepEqual(usage.read('first'), { promptTokens: 20, contextWindow: null, cacheHitRate: 0.4 });
  store.appendEvent(first, 'usage', { totalTokens: 50, inputTokens: 25, outputTokens: 10,
    cacheReadTokens: 10, cacheWriteTokens: 5, contextWindow: 128000 });
  store.appendEvent(other, 'usage', { totalTokens: 12, inputTokens: 9, outputTokens: 3,
    cacheReadTokens: null, cacheWriteTokens: null, contextWindow: 64000 });
  store.appendEvent(first, 'usage', { kind: 'compaction', totalTokens: 8, inputTokens: 6, outputTokens: 2 });
  store.appendEvent(other, 'tool_end', { totalTokens: 9999 });

  assert.deepEqual(usage.read('first'), { promptTokens: 40, contextWindow: 128000, cacheHitRate: 0.25 });
  assert.deepEqual(usage.read('other'), { promptTokens: 9, contextWindow: 64000, cacheHitRate: null });
  const summary = { requests: 4, totalTokens: 95, inputTokens: 52, outputTokens: 20,
    cacheReadTokens: null, cacheWriteTokens: null };
  assert.deepEqual(usage.read(null), summary);
  usage.close();
  assert.deepEqual(usage.read(null), summary);
});
