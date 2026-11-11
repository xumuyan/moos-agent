import { setTimeout as delay } from 'node:timers/promises';

/**
 * 全局桌面操作独占队列（M06）。
 *
 * Mac 的屏幕、前台窗口、鼠标和键盘是全局唯一资源：一次「观察—操作—验证」
 * 持锁执行，完成后释放；其他项目的代码任务不受影响。本模块只负责排队与
 * 互斥本身，不关心具体动作。
 *
 * 语义：
 * - 独占：同一时刻最多一个持有者；FIFO 排队。
 * - waitTimeoutMs：排队等待上限；超时候选从队列移除并抛 QueueTimeoutError，
 *   不影响持有者与其余等待者。
 * - runTimeoutMs：持锁执行上限；到点后通过 AbortSignal 通知执行方，并在
 *   graceMs 内等待其自行结束，仍未结束则放弃等待并释放锁（执行方结果作废）。
 * - signal（AbortSignal）：排队等待或执行过程中的取消；取消排队者从队列移除，
 *   取消执行者由 runTimeout/grace 兜底释放锁。
 * - 异常释放：执行函数抛错/拒绝一律先释放锁再透传错误。
 */

export class QueueTimeoutError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'QueueTimeoutError';
    this.detail = detail;
  }
}

export class QueueCancelledError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'QueueCancelledError';
    this.detail = detail;
  }
}

function validateOwner(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) {
    throw new Error('desktop queue owner must be a non-empty string (<=200 chars)');
  }
  return value;
}

function validateLabel(value) {
  if (value !== undefined && (typeof value !== 'string' || value.length > 300)) {
    throw new Error('desktop queue label must be a string (<=300 chars)');
  }
  return value;
}

export function createDesktopQueue({ clock = Date.now } = {}) {
  let holder = null; // { owner, label, abortController, forced }
  const waiting = []; // { owner, label, signal, abortController, waitTimer, resolve, reject }

  function status() {
    return {
      locked: holder !== null,
      owner: holder?.owner ?? null,
      label: holder?.label ?? null,
      waiting: waiting.map((entry) => ({ owner: entry.owner, label: entry.label })),
    };
  }

  function notifyWaiting() {
    waiting.forEach((entry, index) => {
      try { entry.onQueued?.({ queued: true, queueAhead: index }); } catch { /* 通知失败不影响队列 */ }
    });
  }

  function removeWaiting(entry) {
    const index = waiting.indexOf(entry);
    if (index !== -1) waiting.splice(index, 1);
    if (entry.waitTimer) { clearTimeout(entry.waitTimer); entry.waitTimer = null; }
  }

  function release() {
    if (!holder) return;
    holder = null;
    pump();
  }

  function pump() {
    if (holder || waiting.length === 0) return;
    const entry = waiting.shift();
    notifyWaiting();
    if (entry.waitTimer) { clearTimeout(entry.waitTimer); entry.waitTimer = null; }
    holder = { owner: entry.owner, label: entry.label, abortController: entry.runAbort, forced: false };
    entry.resolve(entry.runAbort.signal);
  }

  /**
   * @param {object} options
   * @param {string} options.owner 持有者标识（如 `conversation:<id>`）。
   * @param {string} [options.label] 动作描述，用于排队状态展示。
   * @param {number} [options.waitTimeoutMs=30000] 排队等待上限。
   * @param {number} [options.runTimeoutMs=120000] 持锁执行上限。
   * @param {number} [options.graceMs=5000] 执行超时后的宽限时间。
   * @param {AbortSignal} [options.signal] 外部取消（排队与执行均生效）。
   * @param {(info: { queued: boolean, queueAhead: number }) => void} [options.onQueued]
   *   排队位置通知：入队时与队列每次变化时触发；空闲接管不触发。
   * @param {(signal: AbortSignal) => Promise<any>} fn 持锁执行的「观察—操作—验证」序列。
   */
  async function withLock(options, fn) {
    if (typeof fn !== 'function') throw new Error('desktop queue requires an executor function');
    const owner = validateOwner(options?.owner);
    const label = validateLabel(options?.label);
    const waitTimeoutMs = Number.isFinite(options?.waitTimeoutMs) && options.waitTimeoutMs > 0
      ? options.waitTimeoutMs : 30000;
    const runTimeoutMs = Number.isFinite(options?.runTimeoutMs) && options.runTimeoutMs > 0
      ? options.runTimeoutMs : 120000;
    const graceMs = Number.isFinite(options?.graceMs) && options.graceMs >= 0 ? options.graceMs : 5000;
    const signal = options?.signal ?? null;

    if (signal?.aborted) throw new QueueCancelledError('desktop operation cancelled before queueing', { owner, label });

    const runAbort = new AbortController();
    const onOuterSignal = () => {
      runAbort.abort(signal.reason ?? 'outer-cancel');
      const entry = waiting.find((item) => item.runAbort === runAbort);
      if (entry) {
        removeWaiting(entry);
        notifyWaiting();
        entry.reject(new QueueCancelledError('desktop operation cancelled while queued', {
          owner, label, queueAhead: 0, reason: 'cancelled',
        }));
      }
    };
    if (signal) signal.addEventListener('abort', onOuterSignal, { once: true });

    const acquired = await new Promise((resolve, reject) => {
      const entry = {
        owner, label, signal, runAbort,
        onQueued: typeof options?.onQueued === 'function' ? options.onQueued : null,
        waitTimer: null, resolve, reject,
      };
      if (!holder) {
        // 空闲直接接管，无需入队。
        holder = { owner, label, abortController: runAbort, forced: false };
        resolve(runAbort.signal);
        return;
      }
      waiting.push(entry);
      notifyWaiting();
      entry.waitTimer = setTimeout(() => {
        removeWaiting(entry);
        notifyWaiting();
        entry.reject(new QueueTimeoutError('desktop operation timed out while queued', {
          owner, label, waitedMs: waitTimeoutMs,
          holderOwner: holder?.owner ?? null,
          reason: 'wait-timeout',
        }));
      }, waitTimeoutMs);
    });

    const startedAt = clock();
    let runTimer = null;
    let graceTimer = null;
    let timedOut = null;
    try {
      runTimer = setTimeout(() => {
        if (holder?.abortController === runAbort) {
          holder.forced = true;
          timedOut = new QueueCancelledError('desktop operation exceeded run timeout', {
            owner, label, runTimeoutMs, reason: 'run-timeout',
          });
          runAbort.abort(timedOut);
          graceTimer = setTimeout(() => {
            // 宽限期内仍未结束：放弃等待该执行方，直接释放锁给下一个等待者。
            release();
          }, graceMs);
        }
      }, runTimeoutMs);
      const result = await fn(runAbort.signal);
      // 超时后即使执行方自行结束，其结果也不可信（锁可能已易主），一律拒绝。
      if (timedOut) throw timedOut;
      return result;
    } finally {
      if (runTimer) clearTimeout(runTimer);
      if (graceTimer) clearTimeout(graceTimer);
      if (signal) signal.removeEventListener('abort', onOuterSignal);
      if (holder?.abortController === runAbort) release();
    }
  }

  /** 强制释放当前持有者（仅用于异常恢复/测试；正常路径不应调用）。 */
  function releaseAll(reason = 'released') {
    if (holder) {
      holder.abortController.abort(new QueueCancelledError('desktop lock force-released', { owner: holder.owner, reason }));
      holder = null;
    }
    while (waiting.length) {
      const entry = waiting.shift();
      if (entry.waitTimer) clearTimeout(entry.waitTimer);
      entry.reject(new QueueCancelledError('desktop queue cleared while queued', { owner: entry.owner, reason }));
    }
  }

  return { withLock, status, releaseAll };
}
