/** Single-Host FIFO desktop queue. Executors must stop native effects on abort.
 * Cancellation/run timeout rejects late results; after grace the caller settles and
 * the next owner may proceed. A released owner's late completion cannot unlock it.
 */
export class QueueTimeoutError extends Error {
  constructor(message, detail) { super(message); this.name = 'QueueTimeoutError'; this.detail = detail; }
}
export class QueueCancelledError extends Error {
  constructor(message, detail) { super(message); this.name = 'QueueCancelledError'; this.detail = detail; }
}

export function createDesktopQueue() {
  let holder = null;
  const waiting = [];
  const safeNotify = (entry, index) => {
    try { entry.onQueued?.({ queued: true, queueAhead: index }); } catch { /* Observers cannot break actions. */ }
  };
  const notifyWaiting = () => [...waiting].forEach(entry => {
    const index = waiting.indexOf(entry);
    if (index >= 0) safeNotify(entry, index);
  });
  const status = () => ({ locked: holder !== null, owner: holder?.owner ?? null,
    label: holder?.label ?? null, waiting: waiting.map(({ owner, label }) => ({ owner, label })) });

  function pump() {
    if (holder || !waiting.length) return;
    holder = waiting.shift();
    clearTimeout(holder.waitTimer);
    holder.acquired();
    notifyWaiting();
  }
  function remove(entry) {
    const index = waiting.indexOf(entry);
    if (index >= 0) waiting.splice(index, 1);
    clearTimeout(entry.waitTimer);
    notifyWaiting();
  }

  async function withLock(options, fn) {
    if (typeof fn !== 'function') throw new Error('desktop queue requires an executor function');
    const { owner, label, signal, onQueued } = options ?? {};
    if (typeof owner !== 'string' || !owner.trim() || owner.length > 200) throw new Error('desktop queue owner must be a non-empty string (<=200 chars)');
    if (label !== undefined && (typeof label !== 'string' || label.length > 300)) throw new Error('desktop queue label must be a string (<=300 chars)');
    const positive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;
    const waitTimeoutMs = positive(options.waitTimeoutMs, 30000);
    const runTimeoutMs = positive(options.runTimeoutMs, 120000);
    const graceMs = Number.isFinite(options.graceMs) && options.graceMs >= 0 ? options.graceMs : 5000;
    const cancelled = reason => new QueueCancelledError('desktop operation cancelled', { owner, label, reason });
    if (signal?.aborted) throw cancelled('cancelled');
    const controller = new AbortController();
    const entry = { owner, label, onQueued, waitTimer: null };
    let runTimer, graceTimer, failure;
    let rejectGrace;
    // Resolve with an error rather than rejecting before Promise.race has attached.
    const grace = new Promise(resolve => { rejectGrace = resolve; });
    const cancel = error => {
      if (failure) return;
      failure = error;
      controller.abort(error);
      if (holder === entry) graceTimer = setTimeout(() => rejectGrace(error), graceMs);
      else {
        remove(entry);
        entry.reject(error);
      }
    };
    entry.cancel = cancel;
    const onAbort = () => cancel(cancelled('cancelled'));
    try {
      const acquired = new Promise((resolve, reject) => { entry.acquired = resolve; entry.reject = reject; });
      signal?.addEventListener('abort', onAbort, { once: true });
      waiting.push(entry);
      if (!holder) pump();
      else {
        // Install the timer before callbacks, which may synchronously cancel.
        entry.waitTimer = setTimeout(() => cancel(new QueueTimeoutError('desktop operation timed out while queued', {
          owner, label, waitedMs: waitTimeoutMs, holderOwner: holder?.owner ?? null, reason: 'wait-timeout',
        })), waitTimeoutMs);
        notifyWaiting();
      }
      await acquired;
      if (failure) throw failure; // Abort after grant but before executor microtask.
      runTimer = setTimeout(() => cancel(new QueueCancelledError('desktop operation exceeded run timeout', {
        owner, label, runTimeoutMs, reason: 'run-timeout',
      })), runTimeoutMs);
      const result = await Promise.race([
        Promise.resolve().then(() => { if (failure) throw failure; return fn(controller.signal); }),
        grace.then(error => { throw error; }),
      ]);
      if (failure) throw failure;
      return result;
    } catch (error) {
      throw failure ?? error;
    } finally {
      clearTimeout(entry.waitTimer);
      clearTimeout(runTimer);
      clearTimeout(graceTimer);
      signal?.removeEventListener('abort', onAbort);
      if (holder === entry) { holder = null; pump(); }
    }
  }

  function releaseAll(reason = 'released') {
    for (const entry of [...waiting]) entry.cancel(new QueueCancelledError('desktop queue cleared while queued', { owner: entry.owner, reason }));
    if (holder) holder.cancel(new QueueCancelledError('desktop lock force-released', { owner: holder.owner, reason }));
    // Still allow the active executor its grace to terminate native effects.
  }
  return { withLock, status, releaseAll };
}
