import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sidebarTree as tree, projectTreeHeight, sessionCompletions, sessionTreeState } from './desktop-sidebar-tree.ts';
test('sidebar tree dimensions align new-session and three navigation rows without reducing ribbon inset', () => {
  assert.equal(tree.newSessionHeight, 48);
  assert.equal(10 + tree.newSessionMarginTop, 8);
  assert.equal(tree.navigationRowHeight * 3, 114);
  assert.equal(tree.projectTextRightInset, 36);
});
test('only selected project reserves actual session height, including empty, loaded maximum and newly created overflow', () => {
  assert.equal(projectTreeHeight(false, 16), 54);
  assert.equal(projectTreeHeight(true, 0), 54);
  assert.equal(projectTreeHeight(true, 2), 126);
  assert.equal(projectTreeHeight(true, 16), 630);
  assert.equal(projectTreeHeight(true, 17), 666);
  assert.equal(projectTreeHeight(true, -1), 54);
});
test('activity belongs to the busy conversation, not the active selection', () => {
  const row = { projectId: 'a', id: 'one' };
  const selected = { projectId: 'a', sessionId: 'one' };
  const working = { scope: selected, busy: true };
  assert.deepEqual(sessionTreeState(row, selected), { selected: true, working: false });
  assert.deepEqual(sessionTreeState(row, selected, working), { selected: true, working: true });
  assert.deepEqual(sessionTreeState(row, { ...selected, sessionId: 'two' }, working), { selected: false, working: true });
  assert.deepEqual(sessionTreeState(row, selected, { ...working, busy: false }), { selected: true, working: false });
  assert.deepEqual(sessionTreeState(row, selected, { ...working, scope: { ...selected, projectId: 'b' } }), { selected: true, working: false });
});


const key = (projectId, sessionId) => JSON.stringify([projectId, sessionId]);
const run = (projectId, sessionId, status) => ({
  task: { id: 'first', projectId, sessionId, status, errorCode: null }, busy: false, drained: true, error: '',
});
test('confirmed success and failure count once per scoped conversation until it is viewed', () => {
  const completions = sessionCompletions();
  const success = run('a', 'one', 'succeeded');
  const failure = run('b', 'one', 'failed');
  completions.observe(success);
  completions.observe(failure);
  assert.deepEqual([...completions.snapshot()], [[key('a', 'one'), 'succeeded'], [key('b', 'one'), 'failed']]);
  completions.view(key('a', 'one'));
  completions.observe(success);
  assert.deepEqual([...completions.snapshot()], [[key('b', 'one'), 'failed']]);
  failure.task = { ...failure.task, id: 'second', status: 'succeeded' };
  completions.observe(failure);
  assert.deepEqual([...completions.snapshot()], [[key('b', 'one'), 'succeeded']]);
  const relaunched = sessionCompletions();
  relaunched.restore(JSON.stringify([...completions.snapshot()]));
  assert.deepEqual([...relaunched.snapshot()], [...completions.snapshot()]);
  relaunched.view(key('b', 'one'));
  assert.equal(relaunched.snapshot().size, 0);
});

test('only a validated drained result changes unread indicators', () => {
  const completions = sessionCompletions();
  const pending = { ...run('a', 'one', 'failed'), busy: true, drained: false };
  completions.observe(pending);
  pending.busy = false;
  completions.observe(pending);
  pending.drained = true;
  pending.error = 'closed';
  completions.observe(pending);
  completions.observe(run('a', 'cancelled', 'cancelled'));
  completions.observe(run('a', 'interrupted', 'interrupted'));
  assert.equal(completions.snapshot().size, 0);
  pending.error = '';
  completions.observe(pending);
  assert.equal(completions.snapshot().get(key('a', 'one')), 'failed');
});
