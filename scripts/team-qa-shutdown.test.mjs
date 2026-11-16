import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { instrumentQaShutdown, parseQaShutdown, selectQaProcesses, snapshotQaProcesses } from './team-qa-shutdown.mjs';

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
