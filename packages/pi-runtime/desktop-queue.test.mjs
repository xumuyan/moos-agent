import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createDesktopQueue, QueueTimeoutError, QueueCancelledError } from './desktop-queue.mjs';

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

test('desktop queue grants exclusive access and serializes holders', async () => {
  const queue = createDesktopQueue();
  const events = [];
  const first = queue.withLock({ owner: 'a', label: 'one' }, async () => {
    events.push('a-start');
    assert.equal(queue.status().locked, true);
    assert.equal(queue.status().owner, 'a');
    await delay(50);
    events.push('a-end');
    return 1;
  });
  const second = queue.withLock({ owner: 'b', label: 'two' }, async () => {
    events.push('b-start');
    return 2;
  });
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.equal(events.indexOf('a-end'), events.indexOf('b-start') - 1);
  assert.equal(queue.status().locked, false);
});

test('desktop queue is fair FIFO and reports waiting entries', async () => {
  const queue = createDesktopQueue();
  const order = [];
  const releaseHolder = (() => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; })();
  const holder = queue.withLock({ owner: 'holder' }, async () => releaseHolder.promise);
  const q1 = queue.withLock({ owner: 'w1' }, async () => order.push('w1'));
  const q2 = queue.withLock({ owner: 'w2' }, async () => order.push('w2'));
  await delay(10);
  assert.deepEqual(queue.status().waiting.map((item) => item.owner), ['w1', 'w2']);
  releaseHolder.resolve();
  await holder; await q1; await q2;
  assert.deepEqual(order, ['w1', 'w2']);
});

test('desktop queue rejects queued waiters on wait timeout without breaking the queue', async () => {
  const queue = createDesktopQueue();
  const gate = (() => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; })();
  const holder = queue.withLock({ owner: 'slow-holder' }, async () => gate.promise);
  const timedOut = queue.withLock({ owner: 'impatient', waitTimeoutMs: 30 }, async () => 'never');
  await assert.rejects(timedOut, (error) => {
    assert.ok(error instanceof QueueTimeoutError);
    assert.equal(error.detail.reason, 'wait-timeout');
    assert.equal(error.detail.holderOwner, 'slow-holder');
    return true;
  });
  // 超时候选被移除后，队列对其余等待者仍然公平可用。
  const follower = queue.withLock({ owner: 'patient', waitTimeoutMs: 5000 }, async () => 'done');
  gate.resolve();
  await holder;
  assert.equal(await follower, 'done');
  assert.equal(queue.status().locked, false);
});

test('desktop queue removes a cancelled waiter without touching holder or others', async () => {
  const queue = createDesktopQueue();
  const gate = (() => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; })();
  const holder = queue.withLock({ owner: 'holder' }, async () => gate.promise);
  const controller = new AbortController();
  const cancelled = queue.withLock({ owner: 'quitter', signal: controller.signal }, async () => 'never');
  await delay(10);
  controller.abort();
  await assert.rejects(cancelled, (error) => {
    assert.ok(error instanceof QueueCancelledError);
    assert.equal(error.detail.reason, 'cancelled');
    return true;
  });
  assert.deepEqual(queue.status().waiting, []);
  const follower = queue.withLock({ owner: 'next' }, async () => 'ok');
  gate.resolve();
  await holder; await follower;
  assert.deepEqual(queue.status(), { locked: false, owner: null, label: null, waiting: [] });
});

test('desktop queue rejects immediately when signal already aborted', async () => {
  const queue = createDesktopQueue();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    queue.withLock({ owner: 'x', signal: controller.signal }, async () => 'never'),
    QueueCancelledError,
  );
  assert.equal(queue.status().locked, false);
});

test('desktop queue releases the lock when the executor throws and passes the error through', async () => {
  const queue = createDesktopQueue();
  await assert.rejects(
    queue.withLock({ owner: 'boom' }, async () => { throw new Error('action failed'); }),
    /action failed/,
  );
  assert.equal(queue.status().locked, false);
  assert.equal(await queue.withLock({ owner: 'after' }, async () => 'recovered'), 'recovered');
});

test('desktop queue aborts executor on run timeout and frees the lock after grace', async () => {
  const queue = createDesktopQueue();
  const observed = [];
  const stubborn = queue.withLock(
    { owner: 'stubborn', runTimeoutMs: 40, graceMs: 60 },
    async (signal) => {
      const aborted = once(signal, 'abort').then(() => 'aborted');
      observed.push(signal);
      await Promise.race([delay(5000), aborted]);
      return 'ignored-after-force-release';
    },
  );
  const follower = queue.withLock({ owner: 'follower', waitTimeoutMs: 3000 }, async () => 'took-over');
  assert.equal(await follower, 'took-over');
  await assert.rejects(stubborn, QueueCancelledError);
  assert.equal(queue.status().locked, false);
  assert.ok(observed[0].aborted);
});

test('desktop queue propagates outer cancellation to a running executor and still releases', async () => {
  const queue = createDesktopQueue();
  const controller = new AbortController();
  const running = queue.withLock({ owner: 'task-a', signal: controller.signal }, async (signal) => {
    await once(signal, 'abort');
    throw new Error('cancelled mid-action');
  });
  await delay(10);
  controller.abort();
  await assert.rejects(running, /cancelled mid-action/);
  assert.equal(queue.status().locked, false);
});

test('desktop queue exposes status details for queue UI', async () => {
  const queue = createDesktopQueue();
  const gate = (() => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; })();
  const holder = queue.withLock({ owner: 'conversation:7', label: '点击浏览器地址栏' }, async () => gate.promise);
  const queued = queue.withLock({ owner: 'conversation:9', label: '截取屏幕' }, async () => 'x');
  await delay(5);
  assert.deepEqual(queue.status(), {
    locked: true,
    owner: 'conversation:7',
    label: '点击浏览器地址栏',
    waiting: [{ owner: 'conversation:9', label: '截取屏幕' }],
  });
  gate.resolve();
  await holder; await queued;
});

test('desktop queue validates owner and executor', async () => {
  const queue = createDesktopQueue();
  await assert.rejects(queue.withLock({ owner: '' }, async () => {}), /owner/);
  await assert.rejects(queue.withLock({ owner: 'a' }, 'not-a-function'), /executor/);
});

test('desktop queue releaseAll aborts holder and rejects all waiters', async () => {
  const queue = createDesktopQueue();
  const gate = (() => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; })();
  const holder = queue.withLock({ owner: 'h' }, async (signal) => { await once(signal, 'abort'); return 'aborted-out'; });
  const waiter = queue.withLock({ owner: 'w' }, async () => 'never');
  await delay(5);
  queue.releaseAll('cleanup');
  assert.equal(await holder, 'aborted-out');
  await assert.rejects(waiter, QueueCancelledError);
  assert.equal(queue.status().locked, false);
});

test('onQueued reports queue position on enqueue and on every shift', async () => {
  const queue = createDesktopQueue();
  const seen = { a: [], b: [], c: [] };
  const releaseGate = deferred();
  const first = queue.withLock({ owner: 'a', label: 'A', waitTimeoutMs: 5000, runTimeoutMs: 5000, graceMs: 100,
    onQueued: (info) => seen.a.push(info) },
    () => releaseGate.promise);
  const second = queue.withLock({ owner: 'b', label: 'B', waitTimeoutMs: 5000, runTimeoutMs: 5000, graceMs: 100,
    onQueued: (info) => seen.b.push(info) },
    async () => 'b-done');
  const third = queue.withLock({ owner: 'c', label: 'C', waitTimeoutMs: 5000, runTimeoutMs: 5000, graceMs: 100,
    onQueued: (info) => seen.c.push(info) },
    async () => 'c-done');
  await delay(20);
  // 空闲接管不触发；b/c 入队各通知一次（b 前 0 个，c 前 1 个）。
  assert.deepEqual(seen.a, []);
  assert.equal(seen.b.at(-1).queueAhead, 0);
  assert.equal(seen.c.at(-1).queueAhead, 1);
  releaseGate.resolve('a-done');
  await delay(20);
  // a 释放后：b 接管（不再收到通知），c 前移到 0。
  assert.ok(seen.c.length >= 2, 'c should be notified again after shift');
  assert.equal(seen.c.at(-1).queueAhead, 0);
  assert.deepEqual(await Promise.all([first, second, third]), ['a-done', 'b-done', 'c-done']);
  assert.equal(queue.status().locked, false);
});

test('onQueued notifier failures never break the queue', async () => {
  const queue = createDesktopQueue();
  const gate = deferred();
  const holder = queue.withLock({ owner: 'h', label: 'H', waitTimeoutMs: 5000, runTimeoutMs: 5000, graceMs: 100 }, () => gate.promise);
  const result = queue.withLock({ owner: 'w', label: 'W', waitTimeoutMs: 5000, runTimeoutMs: 5000, graceMs: 100,
    onQueued: () => { throw new Error('notifier exploded'); } }, async () => 'w-done');
  gate.resolve('h-done');
  assert.equal(await result, 'w-done');
  await holder;
  assert.equal(queue.status().locked, false);
});
