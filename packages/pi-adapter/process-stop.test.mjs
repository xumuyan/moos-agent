import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { stopPiProcess } from './index.mjs';

// PI 1.5.0 removes its signal handlers at the beginning of EOF shutdown.
// Model that ordering without relying on load, sleeps or a live model server.
function fakeChild({ cooperative = true, exitOnEof = true } = {}) {
  const child = new EventEmitter();
  Object.assign(child, { exitCode: null, signalCode: null });
  child.calls = [];
  const exit = () => { child.exitCode = 0; child.emit('exit', 0); };
  child.stdin = { end() { child.calls.push('eof'); if (exitOnEof) queueMicrotask(exit); } };
  child.kill = signal => {
    child.calls.push(signal);
    if (cooperative || signal === 'SIGKILL') queueMicrotask(exit);
    return true;
  };
  return child;
}

test('signal cleanup must precede EOF shutdown, even if EOF would exit immediately', async () => {
  const child = fakeChild();
  await stopPiProcess(child);
  assert.deepEqual(child.calls, ['SIGTERM']);
  assert.equal(child.listenerCount('exit'), 0);
});

test('already exited or signal-terminated children are not signalled again', async () => {
  await stopPiProcess(undefined);
  for (const state of [{ exitCode: 0 }, { signalCode: 'SIGTERM' }]) {
    const child = Object.assign(fakeChild(), state);
    await stopPiProcess(child);
    assert.deepEqual(child.calls, []);
  }
});

test('a noncooperative process receives EOF only after signal grace then SIGKILL', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const child = fakeChild({ cooperative: false, exitOnEof: false });
  const stopped = stopPiProcess(child);
  assert.deepEqual(child.calls, ['SIGTERM']);
  t.mock.timers.tick(700);
  // Flush the wait's finally/continuations before advancing its second timer.
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.deepEqual(child.calls, ['SIGTERM', 'eof']);
  t.mock.timers.tick(700);
  await stopped;
  assert.deepEqual(child.calls, ['SIGTERM', 'eof', 'SIGKILL']);
});

// Real subprocess fixture reproduces PI's EOF handler-removal boundary. This
// verifies native-child cleanup, not just mocked calls or a successful PI exit.
test('signal-first shutdown closes a detached child before EOF can remove cleanup', { timeout: 15000 }, async t => {
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { spawn } from 'node:child_process';
    const owned = spawn('/bin/sleep', ['60'], { detached: true, stdio: 'ignore' });
    const cleanup = () => { owned.kill('SIGKILL'); owned.once('exit', () => process.exit(0)); };
    process.on('SIGTERM', cleanup);
    process.stdin.resume();
    process.stdin.on('end', () => {
      process.removeListener('SIGTERM', cleanup);
      setTimeout(cleanup, 5000);
    });
    console.log(owned.pid);
  `], { stdio: ['pipe', 'pipe', 'ignore'] });
  let pid;
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    if (pid) { try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
  });
  child.stdin.on('error', () => {});
  pid = Number(String((await once(child.stdout, 'data'))[0]).trim());
  assert.ok(Number.isSafeInteger(pid) && pid > 1);
  await stopPiProcess(child);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});
