/** Trusted-local project selection BEFORE listener/invitation creation; no HTTP/NSH entry. */
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { startLocalPairingFlow } from './pairing-flow.mjs';
const fail = () => new Error('Local pairing entry rejected');
const exact = (x, keys) => x && typeof x === 'object' && !Array.isArray(x)
  && Object.keys(x).sort().join(',') === [...keys].sort().join(',');
const project = x => typeof x === 'string' && /^[a-z0-9_-]{1,64}$(?![\s\S])/.test(x);

export function createLocalPairingEntry({ projects, pick, tls, present, selectionMs = 60000,
  sessionMs = 120000, now = () => performance.now(), startFlow = startLocalPairingFlow } = {}) {
  if (!Array.isArray(projects) || projects.length < 1 || projects.length > 8 || projects.some(x => !project(x))
    || new Set(projects).size !== projects.length || typeof pick !== 'function' || typeof present !== 'function'
    || typeof now !== 'function' || typeof startFlow !== 'function'
    || !Number.isSafeInteger(selectionMs) || selectionMs < 1 || selectionMs > 60000
    || !Number.isSafeInteger(sessionMs) || sessionMs < 1 || sessionMs > 120000) throw fail();
  const available = Object.freeze([...projects]); // Trusted registry IDs, never remote names/paths.
  let state = 'idle', active, timer, stop, flow, closing, last = -Infinity;
  function clock() {
    const time = now();
    if (!Number.isFinite(time) || time < 0 || time < last) throw fail();
    last = time; return time;
  }
  async function close() {
    state = 'closed'; clearTimeout(timer); stop?.();
    if (flow) { closing ??= Promise.resolve(flow.close()); await closing; }
    // A late startFlow is awaited/closed by begin(); don't claim a pending factory has stopped.
  }
  return Object.freeze({
    async begin() {
      if (state !== 'idle') throw fail();
      state = 'selecting'; active = new AbortController();
      try {
        const started = clock();
        const requestId = randomBytes(32).toString('hex');
        const snapshot = Object.freeze({ version: 1, requestId, projects: available, validForMs: selectionMs });
        const stopped = new Promise((_, reject) => {
          stop = () => { active.abort(); reject(fail()); };
          timer = setTimeout(stop, selectionMs);
        });
        const result = await Promise.race([Promise.resolve().then(() => {
          if (state !== 'selecting' || active.signal.aborted) throw fail();
          return pick(snapshot, active.signal);
        }), stopped]);
        if (state !== 'selecting' || clock() - started >= selectionMs
          || !exact(result, ['version', 'requestId', 'decision', 'projects']) || result.version !== 1
          || result.requestId !== requestId || !Array.isArray(result.projects)) throw fail();
        if (result.decision === 'deny' && result.projects.length === 0) {
          await close(); return { version: 1, status: 'cancelled' };
        }
        if (result.decision !== 'select' || result.projects.length < 1 || result.projects.length > available.length
          || result.projects.some(x => !project(x) || !available.includes(x))
          || new Set(result.projects).size !== result.projects.length) throw fail();
        // Canonical trusted registry order, not presenter-controlled order or mutable reply arrays.
        const chosen = available.filter(x => result.projects.includes(x));
        clearTimeout(timer); stop = undefined; state = 'starting'; active.abort();
        if (state !== 'starting') throw fail(); // Abort listeners may synchronously close the entry.
        const created = await startFlow({ tls, projects: chosen, present, sessionMs, now });
        if (state !== 'starting') { await created.close(); throw fail(); }
        flow = created;
        const material = flow.begin(); // May fail: listener is then closed in catch.
        state = 'invited';
        return { version: 1, status: 'invited', endpoint: flow.endpoint, material };
      } catch { await close(); throw fail(); }
      finally { clearTimeout(timer); stop = undefined; active?.abort(); }
    },
    async reviewPending() {
      if (state !== 'invited') throw fail();
      return flow.reviewPending(); // Explicit local action only; no remote event automatically reviews.
    },
    close
  });
}
