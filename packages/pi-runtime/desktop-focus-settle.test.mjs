import test from 'node:test';
import assert from 'node:assert/strict';
import { settleClickFocus } from './desktop-focus-settle.mjs';

const window = { x: 0, y: 0, width: 800, height: 600 };
const expected = { pid: 1, bundleId: 'local.fixture', windowId: 2, window, role: 'AXWindow', path: [], element: window };
const inner = { ...expected, role: 'AXTextField', path: [1], element: { x: 40, y: 50, width: 218, height: 18 } };
const outer = { ...inner, element: { x: 30, y: 40, width: 240, height: 42 } };
const changed = () => Object.assign(new Error('changed'), { code: 'DESKTOP_FOCUS_CHANGED' });
function harness(sequence, overrides = {}) {
  let clock = 0, reads = 0, waits = 0;
  const input = { expected, changed, now: () => clock,
    read: async (_signal, timeout) => { assert.ok(timeout > 0 && timeout <= 2000); return sequence[Math.min(reads++, sequence.length - 1)]; },
    wait: async ms => { waits++; clock += ms; }, ...overrides };
  return { input, count: () => ({ reads, waits }), advance: ms => { clock += ms; } };
}

test('click observation settles full geometry with three identical snapshots without dispatch authority', async () => {
  const h = harness([inner, outer, outer, outer]);
  assert.deepEqual(await settleClickFocus(h.input), outer);
  assert.deepEqual(h.count(), { reads: 4, waits: 3 });
});

test('click observation with no delivered focus can only report unchanged window, never success', async () => {
  const h = harness([expected]);
  assert.deepEqual(await settleClickFocus(h.input), expected);
  assert.deepEqual(h.count(), { reads: 3, waits: 2 });
});

test('app, exact window, bounds, candidate role or path changes stop immediately', async () => {
  for (const change of [{ pid: 5 }, { bundleId: 'other.app' }, { windowId: 3 }, { window: { ...window, x: 1 } }, { role: 'AXButton' }, { path: [2] }]) {
    const h = harness([inner, { ...inner, ...change }, outer]);
    await assert.rejects(settleClickFocus(h.input), { code: 'DESKTOP_FOCUS_CHANGED' });
    assert.deepEqual(h.count(), { reads: 2, waits: 1 });
  }
});

test('oscillating geometry stops at six reads with no event retry', async () => {
  const h = harness([inner, outer, inner, outer, inner, outer]);
  await assert.rejects(settleClickFocus(h.input), { code: 'DESKTOP_FOCUS_CHANGED' });
  assert.deepEqual(h.count(), { reads: 6, waits: 5 });
});

test('deadline rejects even an identical late result and does not start another read', async () => {
  let reads = 0;
  const h = harness([], { read: async () => { reads++; h.advance(2000); return outer; } });
  await assert.rejects(settleClickFocus(h.input), { code: 'DESKTOP_FOCUS_CHANGED' });
  assert.equal(reads, 1);
});

test('unavailable focus fails without retry', async () => {
  let reads = 0;
  const h = harness([], { read: async () => { reads++; throw changed(); } });
  await assert.rejects(settleClickFocus(h.input), { code: 'DESKTOP_FOCUS_CHANGED' });
  assert.equal(reads, 1);
});

test('cancellation before and during wait prevents further reads', async () => {
  for (const preAborted of [true, false]) {
    const controller = new AbortController();
    const h = harness([inner], { signal: controller.signal, wait: async () => { controller.abort(); } });
    if (preAborted) controller.abort();
    await assert.rejects(settleClickFocus(h.input), { name: 'AbortError' });
    assert.equal(h.count().reads, preAborted ? 0 : 1);
  }
});

test('cancellation on a third identical read cannot return stable authority', async () => {
  const controller = new AbortController(); let reads = 0;
  const h = harness([], { signal: controller.signal, read: async () => { if (++reads === 3) controller.abort(); return outer; } });
  await assert.rejects(settleClickFocus(h.input), { name: 'AbortError' });
  assert.equal(reads, 3);
});
