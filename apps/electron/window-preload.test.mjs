import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('the workbench gets the macOS layout even when fullscreen arrives before the DOM', async () => {
  const code = await readFile(new URL('./window-preload.cjs', import.meta.url), 'utf8');
  const document = { documentElement: null };
  let ready;
  let fullscreen;
  let usage;
  let turn;
  const messages = [];
  runInNewContext(code, {
    document,
    window: { addEventListener: (event, callback) => {
      assert.equal(event, 'DOMContentLoaded');
      ready = callback;
    } },
    require: name => {
      assert.equal(name, 'electron');
      return {
        contextBridge: { exposeInMainWorld: (key, value) => {
          if (key === 'moosUsage') usage = value;
          else {
            assert.equal(key, 'moosTurn');
            turn = value;
          }
        } },
        ipcRenderer: {
          on: (event, callback) => {
            assert.equal(event, 'moos:window-fullscreen');
            fullscreen = callback;
          },
          invoke: (...args) => { messages.push(args); },
        },
      };
    },
  });
  fullscreen({}, true);
  document.documentElement = { dataset: {} };
  ready();
  assert.deepEqual(document.documentElement.dataset, { moosWindow: 'darwin', fullscreen: 'true' });
  fullscreen({}, false);
  assert.deepEqual(document.documentElement.dataset, { moosWindow: 'darwin' });
  usage.summary();
  usage.latest('session-id');
  turn('session-id', 12);
  assert.deepEqual(messages, [['moos:pi-usage', null], ['moos:pi-usage', 'session-id'], ['moos:pi-turn', 'session-id', 12]]);
});
