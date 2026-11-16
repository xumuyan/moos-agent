import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { instrumentQaShutdown, parseQaShutdown, selectQaProcesses, snapshotQaProcesses, summarizeQaSample, sampleQaProcess, cleanupQaChild, waitQaExit } from './team-qa-shutdown.mjs';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('QA shutdown instrumentation preserves awaited Host cleanup and records ordered lifecycle', async () => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const app = new EventEmitter(); const logs = []; let prevented = 0, quit = 0, stops = 0;
  app.setName = () => {}; app.quit = () => { quit++; };
  const source = `app.setName('沐码'); let hostStopped = false;
app.on('before-quit', event => {
  if (hostStopped) return;
  event.preventDefault();
  void host.stop().finally(() => { hostStopped = true; app.quit(); });
});`;
  vm.runInNewContext(instrumentQaShutdown(source), { app, host: { stop() { stops++; return pending; } },
    console: { error(line) { logs.push(line); } } });
  app.emit('before-quit', { preventDefault() { prevented++; } });
  assert.equal(stops, 1); assert.equal(prevented, 1); assert.equal(quit, 0);
  assert.deepEqual(logs.map(line => parseQaShutdown(line)?.event), ['before-quit', 'host-stop-start']);
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(quit, 1);
  assert.deepEqual(logs.map(line => parseQaShutdown(line)?.event), ['before-quit', 'host-stop-start', 'host-stop-settled']);
  const window = new EventEmitter(); window.webContents = new EventEmitter();
  app.emit('browser-window-created', {}, window); window.emit('closed'); window.webContents.emit('destroyed');
  assert.deepEqual(logs.slice(-2).map(line => parseQaShutdown(line)?.event), ['window-closed', 'webcontents-destroyed']);
});

test('QA instrumentation rejects unsupported entry shapes and parser strips unknown fields', () => {
  for (const source of ['', "app.setName('沐码');", "app.setName('沐码'); app.setName('沐码'); host.stop().finally(x)"]) {
    assert.throws(() => instrumentQaShutdown(source), /Unsupported QA shutdown/);
  }
  assert.deepEqual(parseQaShutdown('MUMA_QA_SHUTDOWN {"event":"quit","at":1,"private":"discard"}'), { event: 'quit', at: 1 });
  for (const line of ['unrelated', 'MUMA_QA_SHUTDOWN nope', 'MUMA_QA_SHUTDOWN {"event":"secret","at":1}',
    'MUMA_QA_SHUTDOWN {"event":"quit","at":0}', 'MUMA_QA_SHUTDOWN {"event":"quit","at":"1"}']) {
    assert.equal(parseQaShutdown(line), undefined);
  }
});

test('QA process selection keeps only rooted ancestry with numeric metadata and bounded rows', () => {
  const table = ' 102 101 S\n 99 1 S\n 101 100 S+\n 100 1 R\n 103 102 Z\n 104 99 S\n 105 100 S secret-token\n';
  assert.deepEqual(selectQaProcesses(table, 100), [
    { pid: 102, ppid: 101, state: 'S' }, { pid: 101, ppid: 100, state: 'S+' },
    { pid: 100, ppid: 1, state: 'R' }, { pid: 103, ppid: 102, state: 'Z' },
  ]);
  assert.deepEqual(selectQaProcesses(table, 200), []);
  for (const pid of [0, 1, -1, 1.5, '100']) assert.throws(() => selectQaProcesses(table, pid), /Invalid QA root/);
  assert.equal(selectQaProcesses(Array.from({ length: 200 }, (_, i) => `${100 + i} ${i ? 100 : 1} S`).join('\n'), 100).length, 128);
});

test('actual process snapshot includes this exact process without command lines', async () => {
  const snapshot = await snapshotQaProcesses(process.pid);
  assert.equal(snapshot.status, 'observed');
  assert.ok(snapshot.processes.some(row => row.pid === process.pid));
  for (const row of snapshot.processes) assert.deepEqual(Object.keys(row).sort(), ['pid', 'ppid', 'state']);
});

test('explicit QA quit fault blocks only the copied app and still awaits Host cleanup', async () => {
  const app = new EventEmitter(); let prevented = 0;
  app.setName = () => {};
  vm.runInNewContext(instrumentQaShutdown("app.setName('沐码'); host.stop().finally(() => {});", { blockQuit: true }),
    { app, host: { stop: () => Promise.resolve() }, console: { error() {} } });
  app.emit('before-quit', { preventDefault() { prevented++; } });
  assert.equal(prevented, 1);
});

const syntheticSample = `Process:         QA [123]
Path: /private/user/secret
Call graph:
    77 Thread_1 DispatchQueue_1: com.apple.main-thread (serial)
    + 77 -[NSApplication run] (in AppKit)
    + 77 __CFRunLoopRun (in CoreFoundation)
    + 77 mach_msg2_trap (in libsystem_kernel.dylib)
    77 Thread_2
    + 77 __psynch_mutexwait
Total number in stack (recursive counted multiple, when >=5):
`;

test('native sample whitelist binds PID and main thread without leaking paths, symbols or metadata', () => {
  const result = summarizeQaSample(syntheticSample, 123);
  assert.deepEqual(result, { boundary: Object.fromEntries(boundaryKeys.map(key => [key, false])), mainThread: { appKitRunLoop: true, coreFoundationRunLoop: true,
    machMessageWait: true, keventWait: false, mutexWait: false, semaphoreWait: false } });
  assert.doesNotMatch(JSON.stringify(result), /private|secret|Process|Path|Thread_1|NSApplication/);
  for (const text of ['', syntheticSample.replace('[123]', '[124]'), syntheticSample.replace('com.apple.main-thread', 'worker'), 'x'.repeat(2 * 1024 * 1024 + 1)]) {
    assert.equal(summarizeQaSample(text, 123), undefined);
  }
  assert.throws(() => summarizeQaSample(syntheticSample, 1), /Invalid QA root/);
});

const boundaryKeys = ['idleLoop', 'singletonCleanup', 'nodeTeardown', 'browserContextTeardown',
  'chromiumShutdown', 'launchServicesCheckOut', 'synchronousXpc', 'processExit'];

function frameSample(frames) {
  return syntheticSample.replace('    + 77 -[NSApplication run] (in AppKit)', frames.map(frame => `    +   ! 77 ${frame} (in synthetic) + 0 [0x123]`).join('\n'));
}

test('native boundary whitelist recognizes only main-thread function frames and exports booleans', () => {
  const cases = {
    idleLoop: ['base::RunLoop::Run(base::Location const&)', 'base::MessagePumpNSApplication::Run(base::MessagePump::Delegate*)'],
    singletonCleanup: ['ProcessSingleton::Cleanup()', 'ProcessSingleton::~ProcessSingleton()'],
    nodeTeardown: ['node::Stop(node::Environment*)', 'node::Environment::RunCleanup()', 'node::Environment::~Environment()'],
    browserContextTeardown: ['electron::ElectronBrowserContext::DestroyAllContexts()'],
    chromiumShutdown: ['electron::ElectronBrowserMainParts::PostMainMessageLoopRun()', 'content::BrowserMainLoop::ShutdownThreadsAndCleanUp()'],
    launchServicesCheckOut: ['_LSApplicationCheckOut'],
    synchronousXpc: ['xpc_connection_send_message_with_reply_sync', '_xpc_pipe_routine'],
    processExit: ['exit', '_exit', '__cxa_finalize'],
  };
  for (const [key, symbols] of Object.entries(cases)) for (const symbol of symbols) {
    const summary = summarizeQaSample(frameSample([symbol]), 123);
    assert.deepEqual(summary.boundary, Object.fromEntries(boundaryKeys.map(k => [k, k === key])), symbol);
    assert.ok(Object.values(summary.boundary).every(value => typeof value === 'boolean'));
    assert.doesNotMatch(JSON.stringify(summary), /synthetic|0x123|ProcessSingleton|Environment|Location/);
  }
  const all = summarizeQaSample(frameSample(Object.values(cases).map(symbols => symbols[0])), 123);
  assert.ok(Object.values(all.boundary).every(Boolean)); // co-occurrence is not precedence or cause
});

test('native boundary classification ignores metadata, other threads, unknown symbols and near names', () => {
  const text = syntheticSample.replace('Path: /private/user/secret', 'Path: /private/node::Stop exit ProcessSingleton::Cleanup')
    .replace('    + 77 __psynch_mutexwait', '    + 77 ProcessSingleton::Cleanup() (in synthetic)')
    .replace('    + 77 -[NSApplication run] (in AppKit)', '    + 77 ??? (in /private/node::Stop)');
  assert.ok(Object.values(summarizeQaSample(text, 123).boundary).every(v => !v));
  const near = frameSample(['myexit', 'exitSomething', 'node::Stopping()', '_LSApplicationCheckOutLater',
    'xpc_pipe_routine_async', 'OtherProcessSingleton::Cleanup()', 'ProcessSingleton::CleanupLater()']);
  assert.ok(Object.values(summarizeQaSample(near, 123).boundary).every(v => !v));
});

test('sampling callback is awaited without blocking the event loop and boundary survives private-file cleanup', async () => {
  const child = { pid: 123, exitCode: null, signalCode: null }; let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let file;
  const observed = sampleQaProcess(child, async (_command, args) => {
    file = args[4]; entered(); await gate;
    await writeFile(file, frameSample(['ProcessSingleton::Cleanup()']));
  });
  await ready;
  await new Promise(resolve => setImmediate(resolve)); // runner can observe child/timers while command pending
  release(); const result = await observed;
  assert.equal(result.status, 'observed'); assert.equal(result.boundary.singletonCleanup, true);
  await assert.rejects(readFile(file), { code: 'ENOENT' });
});

test('actual owned Node sample uses asynchronous command and exports only bounded booleans', { timeout: 15000 }, async () => {
  const child = spawn(process.execPath, ['-e', 'console.log("ready");setInterval(()=>{},1000)'], { stdio: ['ignore', 'pipe', 'ignore'] });
  const closed = once(child, 'exit');
  try {
    await once(child.stdout, 'data');
    const result = await sampleQaProcess(child);
    assert.equal(result.status, 'observed');
    assert.deepEqual(Object.keys(result.boundary), boundaryKeys);
    assert.ok(Object.values(result.boundary).every(v => typeof v === 'boolean'));
    assert.doesNotMatch(JSON.stringify(result), /0x|Path|Process:|Thread_|node::|private/);
  } finally { child.kill('SIGKILL'); await closed; }
});

test('native sample uses exact live QA PID, bounded command and private transient file deleted on all outcomes', async () => {
  const child = { pid: 123, exitCode: null, signalCode: null };
  for (const mode of ['success', 'throw', 'malformed', 'oversized']) {
    let file;
    const result = await sampleQaProcess(child, async (command, args, options) => {
      assert.equal(command, '/usr/bin/sample'); assert.deepEqual(args.slice(0, 4), ['123', '1', '10', '-file']);
      assert.equal(options.timeout, 3000); assert.equal(options.maxBuffer, 2 * 1024 * 1024);
      file = args[4]; assert.equal((await stat(file)).mode & 0o777, 0o600);
      assert.equal((await stat(file.slice(0, file.lastIndexOf('/')))).mode & 0o777, 0o700);
      if (mode === 'throw') throw new Error('private command error');
      await writeFile(file, mode === 'success' ? syntheticSample : mode === 'oversized' ? 'x'.repeat(2 * 1024 * 1024 + 1) : 'private malformed');
    });
    assert.equal(result.status, mode === 'success' ? 'observed' : 'unavailable');
    await assert.rejects(readFile(file), { code: 'ENOENT' });
    assert.doesNotMatch(JSON.stringify(result), /private|malformed|command error/);
  }
  let called = false;
  for (const c of [{ ...child, exitCode: 0 }, { ...child, signalCode: 'SIGTERM' }]) {
    assert.deepEqual(await sampleQaProcess(c, () => { called = true; }), { status: 'already-exited' });
  }
  assert.equal(called, false);
  await assert.rejects(sampleQaProcess({ pid: 1 }), /Invalid QA child/);
});

test('sample failure reasons are fixed enums, not native command stderr', async () => {
  const child = { pid: 123, exitCode: null, signalCode: null };
  assert.deepEqual(await sampleQaProcess(child, () => { throw new Error('/secret private stderr'); }),
    { status: 'unavailable', reason: 'command' });
  assert.deepEqual(await sampleQaProcess(child, async (_command, args) => writeFile(args[4], 'secret')),
    { status: 'unavailable', reason: 'unrecognized-sample' });
});

test('QA child cleanup is bounded, escalates only its spawned child and cannot mark normal quit passed', async () => {
  for (const mode of ['already', 'term', 'kill', 'stuck', 'throw']) {
    const signals = [], waits = []; let release;
    const closed = new Promise(r => { release = r; });
    const child = { pid: 123, exitCode: mode === 'already' ? 0 : null, signalCode: null,
      kill(signal) {
        signals.push(signal);
        if (mode === 'throw') throw new Error('private error');
        if ((mode === 'term' && signal === 'SIGTERM') || (mode === 'kill' && signal === 'SIGKILL')) {
          this.signalCode = signal; release();
        }
        return true;
      } };
    const result = await cleanupQaChild(child, closed, async ms => { waits.push(ms); });
    assert.deepEqual(signals, mode === 'already' ? [] : ['term', 'throw'].includes(mode) ? ['SIGTERM'] : ['SIGTERM', 'SIGKILL']);
    assert.ok(waits.every(ms => ms === 5000));
    assert.equal(result.status, mode === 'already' ? 'already-exited' : mode === 'stuck' ? 'still-running' : mode === 'throw' ? 'unavailable' : 'exited-after-cleanup');
    assert.equal(child.exitCode, mode === 'already' ? 0 : null);
    assert.doesNotMatch(JSON.stringify(result), /private|error/);
  }
  await assert.rejects(cleanupQaChild({ pid: 1 }, Promise.resolve()), /Invalid QA child cleanup/);
});

test('actual owned SIGTERM-ignoring child is reaped by post-evidence cleanup, not normal quit', { timeout: 15000 }, async () => {
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{}); console.log('ready'); setInterval(()=>{},1000)"], { stdio: ['ignore', 'pipe', 'ignore'] });
  const closed = once(child, 'exit');
  try {
    await once(child.stdout, 'data');
    const result = await cleanupQaChild(child, closed, async () => new Promise(r => setTimeout(r, 50)));
    assert.deepEqual(result, { status: 'exited-after-cleanup', termSent: true, killSent: true });
    assert.equal(child.exitCode, null); assert.equal(child.signalCode, 'SIGKILL');
    assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
});

test('QA normal-exit deadline is armed before close dispatch, never extended by a late or lost CDP reply', async () => {
  for (const mode of ['lost-reply', 'late-reply', 'ack-without-exit', 'normal-exit', 'request-error']) {
    const order = []; let deadline, exit, ack, signal;
    const closed = new Promise(r => { exit = r; });
    const reply = new Promise(r => { ack = r; });
    let done = false;
    const observed = waitQaExit(closed, () => {
      order.push('request');
      if (mode === 'request-error') throw new Error('CDP failed');
      return reply;
    }, (ms, s) => {
      assert.equal(ms, 10000); signal = s; order.push('deadline');
      return new Promise(r => { deadline = r; });
    });
    const settled = observed.then(() => { done = true; }, error => { done = error.message; });
    await new Promise(r => setImmediate(r));
    assert.deepEqual(order, ['deadline', 'request']);
    if (mode === 'request-error') {
      await settled; assert.equal(done, 'CDP failed');
    } else if (mode === 'normal-exit') {
      exit(); await settled; assert.equal(done, true); // lost reply doesn't delay exit
    } else {
      if (mode === 'ack-without-exit') { ack(); await new Promise(r => setImmediate(r)); assert.equal(done, false); }
      deadline(); await settled; assert.equal(done, true);
      // Reply or actual exit after the original deadline cannot restart observation.
      ack(); exit(); await new Promise(r => setImmediate(r));
      assert.deepEqual(order, ['deadline', 'request']);
    }
    assert.equal(signal.aborted, true);
  }
  await assert.rejects(waitQaExit(null, () => {}), /Invalid QA exit observation/);
});

test('actual owned child normal exit does not require any CDP acknowledgement', { timeout: 10000 }, async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},30)'], { stdio: 'ignore' });
  const closed = once(child, 'exit');
  try {
    await waitQaExit(closed, () => new Promise(() => {}));
    assert.equal(child.exitCode, 0);
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
});
