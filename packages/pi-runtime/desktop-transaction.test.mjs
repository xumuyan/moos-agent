import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createDesktopQueue } from './desktop-queue.mjs';
import { createDesktopTransaction } from './desktop-transaction.mjs';
const setup = (queue, owner, extra = {}) => createDesktopTransaction({ queue, owner, ...extra });
const focus = { pid: 1, windowId: 2 };

test('lease spans observation, model wait, action and final verification across owners', async () => {
  const queue = createDesktopQueue(), order = [];
  const a = setup(queue, 'a'), b = setup(queue, 'b');
  const id = await a.begin();
  await a.run(id, undefined, async () => order.push('a observe'));
  const observationId = a.recordObservation(id, focus);
  let granted = false;
  const pending = b.begin().then(id => { granted = true; return id; });
  await delay(20); assert.equal(granted, false);
  assert.equal(await Promise.resolve('code task independent'), 'code task independent');
  await a.run(id, undefined, async (_, expected) => { assert.deepEqual(expected, focus); order.push('a input'); }, { requiresObservation: true, observationId });
  await assert.rejects(a.run(id, undefined, () => assert.fail('stale input'), { requiresObservation: true, observationId }), /观察/);
  assert.equal(granted, false);
  await a.run(id, undefined, async () => order.push('a verify'), { finish: true });
  const next = await pending;
  await b.run(next, undefined, async () => order.push('b observe'));
  await b.cancel(next);
  assert.deepEqual(order, ['a observe', 'a input', 'a verify', 'b observe']);
  assert.equal(queue.status().locked, false);
});

test('wrong owner, forged/stale observation, nested and concurrent calls never execute', async () => {
  const queue = createDesktopQueue(), a = setup(queue, 'a'), b = setup(queue, 'b');
  const id = await a.begin();
  await assert.rejects(b.run(id, undefined, () => assert.fail()), /事务/);
  await assert.rejects(a.begin(), /嵌套/);
  await assert.rejects(a.run(id, undefined, () => assert.fail(), { requiresObservation: true, observationId: 'fake' }), /观察/);
  let release; const gate = new Promise(r => { release = r; });
  const running = a.run(id, undefined, () => gate);
  await assert.rejects(a.run(id, undefined, () => assert.fail()), /并行/);
  release(); await running;
  await a.cancel(id);
  await assert.rejects(a.run(id, undefined, () => assert.fail()), /事务/);
});

test('model silence is bounded; expiry invalidates the lease and unblocks the next owner', async () => {
  const queue = createDesktopQueue(), events = [];
  const a = setup(queue, 'a', { limits: { runTimeoutMs: 25, graceMs: 20 }, report: phase => events.push(phase) });
  const b = setup(queue, 'b');
  const old = await a.begin(), next = await b.begin();
  await assert.rejects(a.run(old, undefined, () => assert.fail()), /超时/);
  assert.deepEqual(events, ['running', 'timeout']);
  await b.cancel(next);
});

test('task cancellation between model calls, dispose and action failure release only this lease', async () => {
  for (const kind of ['abort', 'dispose', 'error']) {
    const queue = createDesktopQueue(), task = new AbortController(), events = [];
    const a = setup(queue, 'a', { signal: task.signal, report: phase => events.push(phase) }), b = setup(queue, 'b');
    const id = await a.begin(), pending = b.begin();
    if (kind === 'abort') task.abort();
    if (kind === 'dispose') await a.dispose();
    if (kind === 'error') await assert.rejects(a.run(id, undefined, () => { throw new Error('focus changed'); }), /focus changed/);
    const next = await pending;
    assert.equal(queue.status().owner, 'b');
    await a.dispose(); assert.equal(queue.status().owner, 'b');
    await b.cancel(next);
    assert.deepEqual(events, ['running', kind === 'error' ? 'failed' : 'cancelled']);
  }
});

test('cancellation during action waits for action cleanup; a late success stays rejected', async () => {
  const queue = createDesktopQueue(), task = new AbortController();
  const a = setup(queue, 'a', { signal: task.signal }), b = setup(queue, 'b');
  const id = await a.begin(); let closed = false, started;
  const ready = new Promise(r => { started = r; });
  const run = a.run(id, undefined, async signal => {
    started(); await new Promise(r => signal.addEventListener('abort', r, { once: true }));
    await delay(20); closed = true; return 'late';
  });
  const rejected = assert.rejects(run);
  await ready; const next = b.begin(); task.abort();
  const bid = await next; assert.equal(closed, true); await rejected; await b.cancel(bid);
});

test('queued task cancellation and wait timeout leave holder and next waiter intact', async () => {
  for (const kind of ['abort', 'timeout']) {
    const queue = createDesktopQueue(), task = new AbortController(), events = [];
    const a = setup(queue, 'a'), b = setup(queue, 'b', { signal: task.signal, limits: { waitTimeoutMs: 20 }, report: phase => events.push(phase) });
    const id = await a.begin(); const pending = b.begin();
    const rejected = assert.rejects(pending);
    if (kind === 'abort') task.abort(); await rejected;
    assert.equal(queue.status().owner, 'a');
    assert.deepEqual(events, ['queued', kind === 'abort' ? 'cancelled' : 'timeout']);
    await a.cancel(id);
  }
});
