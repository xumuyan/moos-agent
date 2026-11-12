import { isDeepStrictEqual } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

/** Click-result observation only, never authorizes input or retries a native event.
 * Three identical full snapshots, 100ms apart; at most six reads/2000ms (plus
 * bounded helper shutdown). Any window/app or candidate role/path change stops.
 * AX path is not object identity. A later strict screenshot and fresh observation
 * remain mandatory; geometry changes during capture must still fail.
 */
export async function settleClickFocus({ expected, read, signal, changed,
  now = () => performance.now(), wait = ms => delay(ms, undefined, { signal }) }) {
  const deadline = now() + 2000;
  let candidate, identical = 0;
  for (let n = 0; n < 6; n++) {
    signal?.throwIfAborted();
    const remaining = deadline - now();
    if (remaining <= 0) throw changed();
    const current = await read(signal, Math.max(1, Math.floor(remaining)));
    signal?.throwIfAborted();
    if (now() >= deadline || current.pid !== expected.pid || current.bundleId !== expected.bundleId
      || current.windowId !== expected.windowId || !isDeepStrictEqual(current.window, expected.window)) throw changed();
    if (candidate && (current.role !== candidate.role || !isDeepStrictEqual(current.path, candidate.path))) throw changed();
    identical = candidate && isDeepStrictEqual(candidate, current) ? identical + 1 : 1;
    candidate = current;
    if (identical === 3) return candidate;
    if (n < 5) {
      if (deadline - now() <= 100) throw changed();
      await wait(100);
    }
  }
  throw changed();
}
