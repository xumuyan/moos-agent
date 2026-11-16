import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { instrumentQaShutdown, parseQaShutdown } from './team-qa-shutdown.mjs';

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
