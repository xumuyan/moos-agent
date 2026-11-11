import { randomUUID } from 'node:crypto';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const error = message => Object.assign(new Error(message), { code: 'DESKTOP_TRANSACTION_REQUIRED' });

/** One task-local, bounded lease over the shared desktop queue. No reentrant input.
 * Keep the queue executor alive between model calls; never reacquire for an expired ID.
 * Executors must honour the signal (native helpers wait for close before settling).
 */
export function createDesktopTransaction({ queue, owner, signal, report = () => {}, limits = {} }) {
  let current, disposed = false;
  const notify = (phase, extra = {}) => { try { report(phase, { label: '桌面事务', ...extra }); } catch {} };
  const terminal = e => e?.detail?.reason === 'run-timeout' || e?.name === 'QueueTimeoutError' || e?.name === 'TimeoutError'
    ? 'timeout' : e?.name === 'QueueCancelledError' || e?.name === 'AbortError' ? 'cancelled' : 'failed';
  const requireLease = id => {
    if (!current || current.id !== id || !current.lockSignal || current.ending || current.lockSignal.aborted) {
      throw error('桌面事务不存在、已结束或已超时；必须重新开始并观察，不能重放旧动作');
    }
    return current;
  };
  async function begin(callSignal) {
    if (disposed) throw error('桌面任务已结束');
    if (current) throw error('当前任务已有桌面事务，不允许嵌套');
    signal?.throwIfAborted(); callSignal?.throwIfAborted();
    const lease = { id: randomUUID(), controller: new AbortController(), ready: deferred(), done: deferred(), active: null, ending: false };
    current = lease;
    const signals = [signal, callSignal, lease.controller.signal].filter(Boolean);
    lease.completion = queue.withLock({ owner, label: '桌面事务',
      waitTimeoutMs: 20000, runTimeoutMs: 120000, graceMs: 3000, ...limits,
      signal: AbortSignal.any(signals), onQueued: info => notify('queued', { queueAhead: info.queueAhead }),
    }, async lockSignal => {
      lease.lockSignal = lockSignal;
      const stop = () => { lease.ending = true; lease.done.resolve(); };
      lockSignal.addEventListener('abort', stop, { once: true });
      notify('running'); lease.ready.resolve(lease.id);
      try {
        await lease.done.promise;
        await lease.active?.catch(() => {}); // Child must close before handoff, including cancellation.
        if (lease.failure) throw lease.failure;
        lockSignal.throwIfAborted();
      } finally { lockSignal.removeEventListener('abort', stop); }
    }).then(() => { notify('done'); }, e => {
      lease.failure ??= e;
      lease.ready.reject(e);
      notify(terminal(e));
    }).finally(() => { if (current === lease) current = undefined; });
    const id = await lease.ready.promise;
    if (lease.lockSignal.aborted) { await lease.completion; throw lease.failure ?? error('桌面事务已取消'); }
    return id;
  }
  async function run(id, callSignal, fn, { finish = false, observationId, requiresObservation = false } = {}) {
    const lease = requireLease(id);
    if (lease.active) throw error('同一桌面事务不允许并行动作');
    if (requiresObservation && (!observationId || observationId !== lease.observationId || !lease.focus)) {
      throw error('输入前必须使用本事务最新截图观察目标窗口；观察已过期或未取得焦点信息');
    }
    const expectedFocus = requiresObservation ? lease.focus : undefined;
    if (requiresObservation) { lease.observationId = undefined; lease.focus = undefined; }
    const combined = AbortSignal.any([lease.lockSignal, ...(callSignal ? [callSignal] : [])]);
    lease.active = Promise.resolve().then(() => { combined.throwIfAborted(); return fn(combined, expectedFocus); });
    try {
      const value = await lease.active;
      combined.throwIfAborted();
      if (finish) {
        lease.ending = true; lease.done.resolve();
        await lease.completion;
        if (lease.failure) throw lease.failure;
      }
      return value;
    } catch (e) {
      lease.failure = e; lease.ending = true; lease.done.resolve();
      // fn has already settled; release promptly on an ordinary action error.
      await lease.completion;
      throw e;
    } finally { lease.active = null; }
  }
  function recordObservation(id, focus) {
    const lease = requireLease(id);
    if (lease.active) throw error('桌面动作尚未结束，不能覆盖观察状态');
    lease.focus = focus ?? null;
    lease.observationId = randomUUID();
    return lease.observationId;
  }
  function invalidateObservation(id) { const lease = requireLease(id); lease.observationId = undefined; lease.focus = undefined; }
  async function fail(id, cause) {
    if (current?.id !== id) return;
    current.failure ??= cause;
    await cancel(id);
  }
  async function cancel(id) {
    const lease = current;
    if (!lease || lease.id !== id) throw error('桌面事务不存在或已结束');
    lease.ending = true; lease.controller.abort(); await lease.completion;
  }
  async function dispose() {
    disposed = true;
    if (current) await cancel(current.id);
  }
  return { begin, run, recordObservation, invalidateObservation, cancel, fail, dispose, active: () => Boolean(current) };
}
