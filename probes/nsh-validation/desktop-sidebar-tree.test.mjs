import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sidebarTree as tree, projectTreeHeight, sessionTreeState } from './desktop-sidebar-tree.ts';
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
