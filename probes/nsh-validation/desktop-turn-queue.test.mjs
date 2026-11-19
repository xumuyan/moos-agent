import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextTurnReady, turnQueue, turnQueueLimit, validTurnText } from './desktop-turn-queue.ts';

const success = { busy: false, stopping: false, drained: true, error: '', task: { status: 'succeeded' } };

test('unsent turns retain FIFO order, text and the model snapshot within their scope', () => {
  const q = turnQueue(), choice = { modelId: 'fixture-alternate', reasoningEffort: 'low' };
  assert.ok(q.enqueue('a/1', ' first\nline ', choice));
  assert.ok(q.enqueue('a/1', 'second'));
  assert.ok(q.enqueue('b/1', 'third'));
  choice.reasoningEffort = 'high';
  const [first, second] = q.rows('a/1');
  assert.equal(first.text, ' first\nline ');
  assert.equal(q.edit('b/1', first.id, 'wrong scope'), false);
  q.remove('b/1', second.id);
  assert.equal(q.rows('b/1').length, 1);
  assert.ok(q.edit('a/1', first.id, 'edited first'));
  assert.deepEqual(q.take('a/1', success, false), { id: first.id, text: 'edited first', choice: { modelId: 'fixture-alternate', reasoningEffort: 'low' } });
  assert.equal(q.take('a/1', success, false).id, second.id);
  assert.equal(q.take('a/1', success, false), undefined);
  assert.equal(q.take('b/1', success, false).text, 'third');
});

test('automatic and explicit release both require confirmed terminal and drain; stop holds even if success wins race', () => {
  const q = turnQueue(); assert.ok(q.enqueue('a', 'pending')); assert.ok(q.enqueue('a', 'next'));
  for (const activity of [undefined, ...[{ busy: true }, { stopping: true }, { drained: false }, { error: 'invalid_response' },
    { task: null }, { task: { status: 'running' } }].map(part => ({ ...success, ...part }))]) {
    for (const resume of [false, true]) assert.equal(q.take('a', activity, resume), undefined);
  }
  for (const status of ['failed', 'interrupted', 'cancelled']) {
    const terminal = { ...success, task: { status } };
    assert.equal(nextTurnReady(terminal), false);
    assert.equal(nextTurnReady(terminal, true), true);
    assert.equal(q.take('a', terminal, false), undefined);
  }
  q.pause('a'); assert.equal(q.paused('a'), true);
  assert.equal(q.take('a', success, false), undefined);
  assert.equal(q.take('a', { ...success, task: { status: 'cancelled' } }, true).text, 'pending');
  assert.equal(q.paused('a'), false);
  assert.equal(q.take('a', success, false).text, 'next');
});

test('UTF-8, per-session and view bounds reject excess without losing existing rows', () => {
  const q = turnQueue();
  for (const text of ['', '  \n', 'a\0b', 'a'.repeat(4097), '中文'.repeat(683), '😀'.repeat(1025)]) {
    assert.equal(validTurnText(text), false);
    assert.equal(q.enqueue('a/1', text), false);
  }
  assert.ok(validTurnText('😀'.repeat(1024)));
  for (let i = 0; i < 8; i++) for (let j = 0; j < turnQueueLimit; j++) assert.ok(q.enqueue(`scope-${i}`, `${j}`));
  assert.equal(q.full('scope-0'), true);
  assert.equal(q.enqueue('scope-8', 'overflow'), false);
  const head = q.rows('scope-0')[0];
  assert.equal(q.edit('scope-0', head.id, '\0'), false);
  assert.equal(q.rows('scope-0')[0], head);
  q.remove('scope-0', head.id);
  assert.ok(q.enqueue('scope-8', 'space freed'));
  q.pause('scope-8'); q.clear();
  assert.deepEqual(q.rows('scope-8'), []);
  assert.equal(q.paused('scope-8'), false);
  assert.equal(q.full('scope-0'), false);
});
