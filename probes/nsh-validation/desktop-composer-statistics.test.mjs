import { test } from 'node:test';
import assert from 'node:assert/strict';
import { desktopTaskStatistics } from './desktop-statistics.mjs';
import { composerStatistics, readTaskStatistics, showCount, showRate, showContext, showTime } from './desktop-composer-statistics.ts';

const missing = { toolSteps: null, elapsedMs: null, toolMs: null, cacheHitRate: null, context: null };
test('Host measures execution and matched tools; uses latest actual usage, not compaction or estimated cache', () => {
  let now = 0;
  const s = desktopTaskStatistics(() => now);
  const event = (time, type, payload) => { now = time; s.observe({ type, payload }); };
  event(0, 'task_state', { status: 'queued' });
  assert.deepEqual(s.snapshot(), missing);
  event(50, 'task_state', { status: 'running' });
  event(100, 'tool_start', { toolCallId: 'first', args: 'not public' });
  event(110, 'tool_start', { toolCallId: 'second' });
  event(120, 'tool_end', { toolCallId: 'first' });
  assert.equal(s.snapshot().toolMs, null);
  event(135, 'tool_end', { toolCallId: 'second', isError: true });
  event(140, 'usage', { inputTokens: 290, cacheReadTokens: 100, cacheWriteTokens: 10, outputTokens: 20, totalTokens: 420, contextWindow: 64000 });
  event(145, 'usage', { kind: 'compaction', totalTokens: 999, contextWindow: 32000 });
  event(150, 'task_state', { status: 'succeeded' });
  assert.deepEqual(s.snapshot(), { toolSteps: 2, elapsedMs: 100, toolMs: 45, cacheHitRate: .25, context: { tokens: 420, window: 64000 } });
  event(155, 'usage', { inputTokens: 8, cacheReadTokens: null, totalTokens: 10, contextWindow: 32000 });
  assert.equal(s.snapshot().cacheHitRate, null);
  assert.deepEqual(s.snapshot().context, { tokens: 10, window: 32000 });
  event(160, 'usage', { outputTokens: 2, totalTokens: 10, cacheReadTokens: 0 });
  assert.equal(s.snapshot().cacheHitRate, 0);
  assert.equal(s.snapshot().context, null);
  event(165, 'usage', { outputTokens: 3, totalTokens: 5, cacheReadTokens: 3 });
  assert.equal(s.snapshot().cacheHitRate, null);
  event(170, 'tool_end', { toolCallId: 'missing-start' });
  assert.equal(s.snapshot().toolMs, null);
});

test('scoped observations publish once only after controller-confirmed terminal and drain', () => {
  const stats = composerStatistics(), a = { projectId: 'a', sessionId: 'one' }, b = { ...a, sessionId: 'two' };
  const drained = (scope, id) => ({ scope, task: { ...scope, id, status: 'succeeded', errorCode: null }, cursor: `${id}:5`, drained: true, error: '' });
  const first = drained(a, 'task1'), second = drained(a, 'task2'), third = drained(a, 'task3'), foreign = drained(b, 'task1');
  const stage = ({ task, cursor }, other) => stats.stage({ projectId: task.projectId, sessionId: task.sessionId, taskId: task.id },
    { task, cursor, terminal: true, hasMore: false, statistics: { toolSteps: 2 }, ...other });
  stage(first, { hasMore: true }); stats.confirm([first]); assert.equal(stats.read(a).rounds, null);
  stage(first, { task: foreign.task }); stats.confirm([first]); assert.equal(stats.read(a).rounds, null);
  stage(first); stats.confirm([{ ...first, drained: false }, foreign]); assert.equal(stats.read(a).rounds, null);
  stats.confirm([{ ...first, cursor: 'task1:4' }]); assert.equal(stats.read(a).rounds, null);
  stats.confirm([{ ...first, error: 'invalid_response' }]); stats.confirm([first]); assert.equal(stats.read(a).rounds, null);
  stage(first); stats.confirm([first]); stage(first); stats.confirm([first]);
  assert.deepEqual(stats.read(a), { ...missing, toolSteps: 2, rounds: 1 });
  assert.equal(stats.read(b).rounds, null);
  assert.equal(stats.read({ ...a, projectId: 'other' }).rounds, null);
  stage(second, { statistics: { toolSteps: 3, elapsedMs: 50 } }); stats.confirm([first, second]);
  assert.deepEqual(stats.read(a), { ...missing, rounds: 2, toolSteps: 5, elapsedMs: 50 });
  stage(third, { statistics: undefined }); stats.confirm([third]);
  assert.deepEqual(stats.read(a), { ...missing, rounds: 3 });
  stats.clear(); assert.deepEqual(stats.read(a), { ...missing, rounds: null });
});

test('unsupported, invalid and partial readings do not invent numbers; zero is not missing', () => {
  assert.deepEqual(readTaskStatistics(null), missing);
  assert.deepEqual(readTaskStatistics({ toolSteps: -1, toolMs: Infinity, elapsedMs: '5', cacheHitRate: NaN, context: { tokens: 20, window: 0 } }), missing);
  assert.deepEqual(readTaskStatistics({ toolSteps: 0, cacheHitRate: 0, context: { tokens: 0, window: 8 } }), { ...missing, toolSteps: 0, cacheHitRate: 0, context: { tokens: 0, window: 8 } });
  assert.deepEqual([showCount(null), showRate(null), showContext(null), showTime(null)], ['—', '—', '—', '—']);
  assert.deepEqual([showCount(0), showRate(0), showContext({ tokens: 0, window: 8 }), showTime(0)], ['0', '0%', '0 / 8', '0 ms']);
  assert.equal(showContext({ tokens: 80660, window: 128000 }), '80,660 / 128,000');
});
