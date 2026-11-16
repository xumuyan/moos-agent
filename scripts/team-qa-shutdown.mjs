import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

// Instrument only the copied QA entry. Never emit URLs, tokens or user content.
export function instrumentQaShutdown(source, { blockQuit = false } = {}) {
  const marker = "app.setName('沐码');";
  const stop = 'host.stop().finally(';
  if (source.split(marker).length !== 2 || source.split(stop).length !== 2) {
    throw new Error('Unsupported QA shutdown instrumentation entry');
  }
  return source.replace(marker, `
const qaShutdownEvent = event => console.error('MUMA_QA_SHUTDOWN ' + JSON.stringify({ event, at: Date.now() }));
${blockQuit ? "app.on('before-quit', event => event.preventDefault());" : ''}
for (const event of ['before-quit', 'will-quit', 'quit', 'window-all-closed']) app.on(event, () => qaShutdownEvent(event));
app.on('browser-window-created', (_event, window) => {
  window.on('close', () => qaShutdownEvent('window-close'));
  window.on('closed', () => qaShutdownEvent('window-closed'));
  window.webContents.on('destroyed', () => qaShutdownEvent('webcontents-destroyed'));
});
${marker}`).replace(stop, `(qaShutdownEvent('host-stop-start'), host.stop()).finally(() => qaShutdownEvent('host-stop-settled')).finally(`);
}

export function parseQaShutdown(line) {
  const prefix = 'MUMA_QA_SHUTDOWN ';
  if (!line.startsWith(prefix)) return undefined;
  try {
    const value = JSON.parse(line.slice(prefix.length));
    const allowed = ['before-quit', 'will-quit', 'quit', 'window-all-closed', 'window-close',
      'window-closed', 'webcontents-destroyed', 'host-stop-start', 'host-stop-settled'];
    if (allowed.includes(value.event) && Number.isSafeInteger(value.at) && value.at > 0) {
      return { event: value.event, at: value.at };
    }
  } catch {}
}

// ps output contains only numeric IDs and the kernel state, never command lines.
export function selectQaProcesses(text, rootPid) {
  if (!Number.isSafeInteger(rootPid) || rootPid <= 1) throw new Error('Invalid QA root PID');
  const rows = text.split('\n').flatMap(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+([A-Za-z+<>NsXEW-]{1,16})\s*$/.exec(line);
    if (!match) return [];
    const pid = Number(match[1]), ppid = Number(match[2]);
    return Number.isSafeInteger(pid) && Number.isSafeInteger(ppid) && pid > 1 && ppid >= 0
      ? [{ pid, ppid, state: match[3] }] : [];
  });
  const selected = new Set([rootPid]);
  for (let round = 0; round < rows.length; round++) {
    let added = false;
    for (const row of rows) if (selected.has(row.ppid) && !selected.has(row.pid)) { selected.add(row.pid); added = true; }
    if (!added) break;
  }
  return rows.filter(row => selected.has(row.pid)).slice(0, 128);
}

// Never export raw native samples: they contain local paths and image metadata.
export function summarizeQaSample(text, rootPid) {
  if (!Number.isSafeInteger(rootPid) || rootPid <= 1) throw new Error('Invalid QA root PID');
  if (typeof text !== 'string' || Buffer.byteLength(text) > 2 * 1024 * 1024
    || !new RegExp('^Process: +[^\\n]+ \\[' + rootPid + '\\]$', 'm').test(text)) return undefined;
  const graph = text.split('Call graph:\n')[1]?.split('\nTotal number in stack')[0];
  const main = graph?.match(/(?:^|\n)    \d+ Thread_[^\n]*com\.apple\.main-thread[^\n]*\n([\s\S]*?)(?=\n    \d+ Thread_|$)/)?.[1];
  if (!main) return undefined;
  return { mainThread: {
    appKitRunLoop: main.includes('-[NSApplication run]'),
    coreFoundationRunLoop: main.includes('__CFRunLoopRun'),
    machMessageWait: main.includes('mach_msg2_trap'),
    keventWait: /\bkevent(?:64)?\b/.test(main),
    mutexWait: /\b__psynch_mutexwait\b/.test(main),
    semaphoreWait: /\bsemaphore_wait_trap\b/.test(main),
  } };
}

export async function sampleQaProcess(child, run = promisify(execFile)) {
  if (!child || !Number.isSafeInteger(child.pid) || child.pid <= 1) throw new Error('Invalid QA child');
  // Only the runner's still-live copied child; never enumerate/select another app.
  if (child.exitCode !== null || child.signalCode != null) return { status: 'already-exited' };
  let directory, stage = 'filesystem';
  try {
    directory = await mkdtemp(join(tmpdir(), 'muma-qa-sample-'));
    const path = join(directory, 'sample.txt');
    await writeFile(path, '', { mode: 0o600 });
    if (child.exitCode !== null || child.signalCode != null) return { status: 'already-exited' };
    stage = 'command';
    await run('/usr/bin/sample', [String(child.pid), '1', '10', '-file', path],
      { timeout: 3000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' });
    stage = 'filesystem';
    if ((await stat(path)).size > 2 * 1024 * 1024) return { status: 'unavailable', reason: 'size-limit' };
    const summary = summarizeQaSample(await readFile(path, 'utf8'), child.pid);
    return summary ? { status: 'observed', ...summary } : { status: 'unavailable', reason: 'unrecognized-sample' };
  } catch {
    return { status: 'unavailable', reason: stage };
  } finally {
    if (directory) {
      try { await rm(directory, { recursive: true, force: true }); }
      catch { return { status: 'unavailable', reason: 'cleanup' }; }
    }
  }
}

// Arm the exit deadline before dispatching CDP close. A delayed/missing CDP
// acknowledgement must never extend the normal-process-exit observation window.
export async function waitQaExit(closed, requestClose,
  wait = (ms, signal) => sleep(ms, undefined, { signal })) {
  if (!closed || typeof closed.then !== 'function' || typeof requestClose !== 'function') {
    throw new Error('Invalid QA exit observation');
  }
  const controller = new AbortController();
  try {
    const deadline = wait(10000, controller.signal);
    await Promise.race([closed, Promise.resolve().then(requestClose).then(() => closed), deadline]);
  } finally {
    controller.abort();
  }
}

// Post-evidence teardown only, never an application quit-success criterion.
// Accept the exact spawned child, not PIDs discovered by global enumeration.
export async function cleanupQaChild(child, closed, wait = sleep) {
  if (!child || !Number.isSafeInteger(child.pid) || child.pid <= 1
    || typeof child.kill !== 'function' || !closed || typeof closed.then !== 'function') {
    throw new Error('Invalid QA child cleanup');
  }
  const exited = () => child.exitCode !== null || child.signalCode != null;
  const result = { status: 'already-exited', termSent: false, killSent: false };
  if (exited()) return result;
  try {
    result.termSent = child.kill('SIGTERM');
    await Promise.race([closed, wait(5000)]);
    if (!exited()) {
      result.killSent = child.kill('SIGKILL');
      await Promise.race([closed, wait(5000)]);
    }
    result.status = exited() ? 'exited-after-cleanup' : 'still-running';
  } catch {
    result.status = 'unavailable';
  }
  return result;
}

export async function snapshotQaProcesses(rootPid) {
  try {
    const { stdout } = await promisify(execFile)('/bin/ps', ['-axo', 'pid=,ppid=,stat='],
      { timeout: 1500, maxBuffer: 1024 * 1024, encoding: 'utf8' });
    return { status: 'observed', processes: selectQaProcesses(stdout, rootPid) };
  } catch {
    return { status: 'unavailable', processes: [] };
  }
}
