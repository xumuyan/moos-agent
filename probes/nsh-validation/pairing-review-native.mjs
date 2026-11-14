/** Trusted host adapter. Executable is a locally built path, never supplied by a network peer. */
import { spawn } from 'node:child_process';
export function nativePairingPresenter(executable, { automationDeny = false } = {}) {
  return (snapshot, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Local pairing review stopped')); return; }
    const child = spawn(executable, automationDeny ? ['--automation-deny'] : [], { stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '', settled = false;
    const timer = setTimeout(() => finish(), snapshot.validForMs + 2000);
    const stop = () => finish();
    function finish(result) {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', stop);
      child.kill('SIGTERM');
      if (result) resolve(result); else reject(new Error('Local pairing review stopped'));
    }
    signal?.addEventListener('abort', stop, { once: true });
    child.once('error', () => finish()); child.stdin.on('error', () => finish());
    child.stdout.on('data', chunk => { output += chunk; if (Buffer.byteLength(output) > 4096) finish(); });
    child.once('close', code => { // Wait for stdout drain; exit alone may precede the final reply bytes.
      if (code !== 0) { finish(); return; }
      try { finish(JSON.parse(output)); } catch { finish(); }
    });
    child.stdin.end(JSON.stringify(snapshot));
  });
}
