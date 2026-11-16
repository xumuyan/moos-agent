/** Trusted native parent spawns this fixed file with private stdin/stdout pipes.
 * NDJSON v1. No task listener or CLI/environment model configuration.
 */
import { startDesktopHost } from './desktop-host.mjs';
import { pathToFileURL } from 'node:url';

export const MAX_REQUEST_BYTES = 16384;
export const MAX_RESPONSE_BYTES = 512 * 1024;

// start/writeTimeoutMs are trusted test seams, never wire parameters.
export async function serveDesktopPipe({ input = process.stdin, output = process.stdout,
  start = startDesktopHost, writeTimeoutMs = 5000 } = {}) {
  let host, closing, pending = Buffer.alloc(0), failed = false, stopped = false;
  let interruptWrite;
  const close = () => {
    if (host && !closing) {
      closing = Promise.resolve().then(() => host.close());
      closing.catch(() => {}); // observed again in finally, including failure during startup
    }
  };
  const stop = (failure = false) => {
    failed ||= failure; stopped = true;
    interruptWrite?.();
    input.destroy();
    if (failure) output.destroy();
    close();
  };
  const outputFailed = () => stop(true);
  const inputFailed = () => stop(true);
  // EOF/parent loss revokes admission immediately, even if stdout is blocked.
  const inputEnded = () => { stopped = true; interruptWrite?.(); close(); };
  const inputClosed = () => { stopped = true; interruptWrite?.(); close(); };
  input.on('end', inputEnded); input.on('close', inputClosed); input.on('error', inputFailed);
  output.on('error', outputFailed); output.on('close', outputFailed);
  try {
    host = await start();
    if (stopped || input.destroyed || output.destroyed) { close(); return { failed }; }
    for await (const value of input) {
      const chunk = Buffer.from(value);
      let offset = 0;
      while (offset < chunk.length && !stopped) {
        const newline = chunk.indexOf(10, offset);
        const end = newline < 0 ? chunk.length : newline;
        if (pending.length + end - offset > MAX_REQUEST_BYTES) throw new Error('Frame limit');
        pending = Buffer.concat([pending, chunk.subarray(offset, end)]);
        offset = end + 1;
        if (newline < 0) break;
        let request;
        try { request = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(pending)); }
        catch { request = null; }
        pending = Buffer.alloc(0);
        const response = JSON.stringify(host.call(request)) + '\n';
        if (Buffer.byteLength(response) > MAX_RESPONSE_BYTES) throw new Error('Response limit');
        // Exactly one bounded write in flight. A stalled reader cannot retain live PI forever.
        await new Promise((resolve, reject) => {
          let timer, settled = false;
          const done = error => {
            if (settled) return;
            settled = true;
            clearTimeout(timer); interruptWrite = undefined;
            error ? reject(error) : resolve();
          };
          interruptWrite = () => done(Object.assign(new Error('Pipe closed'), { code: failed ? 'pipe' : 'eof' }));
          timer = setTimeout(() => { stop(true); }, writeTimeoutMs);
          try { output.write(response, done); } catch (error) { done(error); }
        });
      }
      if (stopped) break;
    }
    if (pending.length) throw new Error('Incomplete frame');
  } catch (error) { if (error.code !== 'eof') stop(true); }
  finally {
    stopped = true; close();
    try { await closing; }
    finally {
      input.off('end', inputEnded); input.off('close', inputClosed); input.off('error', inputFailed);
      output.off('error', outputFailed); output.off('close', outputFailed);
    }
  }
  return { failed };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.stdin.isTTY || process.argv.length !== 2) {
    process.stderr.write('Private desktop pipe required\n'); process.exitCode = 1;
  } else {
    const stop = () => process.stdin.destroy();
    process.on('SIGTERM', stop); process.on('SIGINT', stop);
    try { if ((await serveDesktopPipe()).failed) process.exitCode = 1; }
    catch { process.stderr.write('Desktop host cleanup failed\n'); process.exitCode = 1; }
    finally { process.off('SIGTERM', stop); process.off('SIGINT', stop); }
  }
}
