/** Disposable trusted-local orchestration. No LAN, HTTP approval, task or persistence API. */
import { performance } from 'node:perf_hooks';
import { X509Certificate } from 'node:crypto';
import { startPairingHost } from './pairing-host.mjs';
import { encodeBootstrap } from './bootstrap.mjs';
import { createPairingReviewer } from './pairing-review.mjs';
const rejected = () => new Error('Local pairing flow rejected');

export async function startLocalPairingFlow({ tls, projects, present, sessionMs = 120000,
  now = () => performance.now() } = {}) {
  if (typeof present !== 'function' || typeof now !== 'function'
    || !Number.isSafeInteger(sessionMs) || sessionMs < 1 || sessionMs > 120000
    || !Array.isArray(projects) || projects.length < 1 || projects.length > 8
    || projects.some(x => typeof x !== 'string' || !/^[a-z0-9_-]{1,64}$(?![\s\S])/.test(x))
    || new Set(projects).size !== projects.length) throw rejected();
  const selected = [...projects]; // Fixed by trusted caller before any network request.
  let previous;
  try { previous = now(); } catch { throw rejected(); }
  if (!Number.isFinite(previous) || previous < 0) throw rejected();
  const deadline = previous + sessionMs;
  // HTTP authority must independently fail closed at the whole-session deadline, even
  // before a delayed timer/local action runs. NaN permanently invalidates authority.
  const authorityNow = () => {
    try {
      const time = now();
      if (!Number.isFinite(time) || time < previous || time >= deadline) return NaN;
      previous = time; return time;
    } catch { return NaN; }
  };
  const host = await startPairingHost({ tls, projects: selected, invitationMs: sessionMs, now: authorityNow });
  let state = 'ready', reviewer, closing, timer;
  const close = () => {
    if (!closing) {
      state = 'closed'; clearTimeout(timer); reviewer?.close();
      closing = host.close(); // Synchronously invalidates invites, claims and all issued tokens.
    }
    return closing;
  };
  function remaining() {
    try {
      const time = now();
      if (!Number.isFinite(time) || time < previous || time >= deadline || state === 'closed') throw rejected();
      previous = time;
      const value = Math.floor(deadline - time);
      if (value < 1) throw rejected();
      return value;
    } catch { void close(); throw rejected(); }
  }
  try {
    const left = remaining();
    timer = setTimeout(() => { void close(); }, left);
    const caDER = new X509Certificate(tls.ca).raw;
    return Object.freeze({
      endpoint: host.endpoint,
      // Only an explicit local action creates material. Return bytes privately; never log or put in URL.
      begin() {
        const validForMs = remaining();
        if (state !== 'ready') throw rejected();
        try {
          const invitation = host.invite();
          const bytes = encodeBootstrap({ ...invitation, validForMs }, caDER);
          state = 'invited'; return bytes;
        } catch { void close(); throw rejected(); }
      },
      // Explicit local action, NOT an automatic reaction to an HTTP claim or remote approve endpoint.
      async reviewPending() {
        const left = remaining();
        if (state !== 'invited') throw rejected();
        let pending;
        try { pending = host.pending(); } catch { await close(); throw rejected(); }
        if (pending.length !== 1) throw rejected(); // No pending claim: caller can explicitly try later.
        state = 'reviewing';
        reviewer = createPairingReviewer({ authority: host, endpoint: host.endpoint, now,
          reviewMs: Math.min(left, 60000) });
        try {
          const result = await reviewer.review({ claimId: pending[0].claimId, projects: selected, present });
          remaining();
          if (result.status === 'denied') await close();
          else state = 'approved'; // Only enables one redeem; no token crosses this local API.
          return result;
        } catch { await close(); throw rejected(); }
        finally { reviewer?.close(); reviewer = undefined; }
      },
      close
    });
  } catch { await close(); throw rejected(); }
}
