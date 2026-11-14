/** Trusted-local review only. No HTTP API, JS bridge, credentials or long-term promotion. */
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
const hex = x => typeof x === 'string' && x.length === 64 && /^[a-f0-9]{64}$/.test(x);
const project = x => typeof x === 'string' && /^[a-z0-9_-]{1,64}$(?![\s\S])/.test(x);
const exact = (x, keys) => x && !Array.isArray(x) && typeof x === 'object'
  && Object.keys(x).sort().join(',') === [...keys].sort().join(',');
function reject() { throw new Error('Local pairing review rejected'); }

// The presenter is part of the trusted local process, NOT a network/TSX-supplied callback.
// Only one active review per controller. Authority remains authoritative about expiry.
export function createPairingReviewer({ authority, endpoint, now = () => performance.now(), reviewMs = 60000 } = {}) {
  const url = new URL(endpoint);
  if (!/^https:\/\/(127\.0\.0\.1|localhost):[1-9][0-9]{0,4}$/.test(endpoint)
    || url.protocol !== 'https:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || endpoint !== url.origin || !Number.isSafeInteger(reviewMs) || reviewMs < 1 || reviewMs > 60000
    || typeof authority?.pending !== 'function' || typeof authority?.confirm !== 'function'
    || typeof authority?.deny !== 'function') reject();
  let active = false, last = -Infinity, closed = false, cancelActive;
  function clock() {
    const value = now();
    if (!Number.isFinite(value) || value < last) { closed = true; reject(); }
    last = value; if (closed) reject(); return value;
  }
  return Object.freeze({
    async review({ claimId, projects, present } = {}) {
      if (active || closed || !hex(claimId) || !Array.isArray(projects) || projects.length < 1 || projects.length > 8
        || projects.some(x => !project(x)) || new Set(projects).size !== projects.length || typeof present !== 'function') reject();
      const selected = [...projects];
      const started = clock();
      const pending = authority.pending().find(x => x.claimId === claimId);
      if (!pending || !hex(pending.transcript)) reject();
      const transcript = pending.transcript;
      const requestId = randomBytes(32).toString('hex');
      const snapshot = Object.freeze({ version: 1, requestId, endpoint, claimId, transcript,
        projects: Object.freeze([...selected]), validForMs: reviewMs });
      active = true;
      let approved = false, timer;
      const controller = new AbortController();
      const stopped = new Promise((_, fail) => {
        cancelActive = () => { controller.abort(); fail(new Error('Local pairing review stopped')); };
        timer = setTimeout(cancelActive, reviewMs);
      });
      try {
        const result = await Promise.race([Promise.resolve().then(() => present(snapshot, controller.signal)), stopped]);
        if (clock() - started >= reviewMs || !exact(result, ['version', 'requestId', 'claimId', 'transcript', 'decision'])
          || result.version !== 1 || result.requestId !== requestId || result.claimId !== claimId
          || result.transcript !== transcript || !['approve', 'deny'].includes(result.decision)) reject();
        // Never apply a stale view, even if a different local actor already approved/redeemed it.
        const current = authority.pending().find(x => x.claimId === claimId);
        if (!current || current.transcript !== transcript) reject();
        if (result.decision === 'deny') return { version: 1, status: 'denied' };
        authority.confirm({ claimId, transcript, allowProjects: selected });
        approved = true;
        return { version: 1, status: 'approved' }; // No receipt/token or bootstrap secret.
      } catch { reject(); }
      finally {
        if (!approved) { try { authority.deny(claimId); } catch {} }
        clearTimeout(timer); controller.abort(); cancelActive = undefined; active = false;
      }
    },
    close() { closed = true; cancelActive?.(); } // A late presenter result cannot approve after closure.
  });
}
