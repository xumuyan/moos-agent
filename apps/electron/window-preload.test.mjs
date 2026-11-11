import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('the workbench gets the macOS layout even when fullscreen arrives before the DOM', async () => {
  const code = await readFile(new URL('./window-preload.cjs', import.meta.url), 'utf8');
  const document = { documentElement: null };
  let ready;
  const events = new Map();
  const bridges = new Map();
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
        contextBridge: { exposeInMainWorld: (key, value) => bridges.set(key, value) },
        ipcRenderer: {
          on: (event, callback) => {
            events.set(event, callback);
          },
          removeListener: (event, callback) => {
            assert.equal(events.get(event), callback);
            events.delete(event);
          },
          invoke: (...args) => { messages.push(args); },
        },
      };
    },
  });
  events.get('moos:window-fullscreen')({}, true);
  document.documentElement = { dataset: {} };
  ready();
  assert.deepEqual(document.documentElement.dataset, { moosWindow: 'darwin', fullscreen: 'true' });
  events.get('moos:window-fullscreen')({}, false);
  assert.deepEqual(document.documentElement.dataset, { moosWindow: 'darwin' });
  assert.deepEqual([...bridges.keys()], ['moosUsage', 'moosTurn', 'moosActiveTasks', 'moosShot', 'moosModelSettings', 'moosImageGen',
    'moosExecutionPolicy']);
  bridges.get('moosUsage').summary();
  bridges.get('moosUsage').latest('session-id');
  bridges.get('moosTurn')('session-id', 12);
  bridges.get('moosActiveTasks')();
  const settings = bridges.get('moosModelSettings');
  const draft = { name: 'Relay' };
  settings.list();
  settings.save(draft);
  settings.remove('relay');
  settings.discover(draft);
  settings.test(draft);
  const imageGen = bridges.get('moosImageGen');
  imageGen.status();
  imageGen.save({ enabled: true });
  imageGen.test({ baseUrl: 'https://x/v1' });
  const execution = bridges.get('moosExecutionPolicy');
  execution.status();
  execution.save({ mode: 'danger-full-access' });
  let opened = 0;
  const unsubscribe = settings.onOpen((...args) => { assert.deepEqual(args, []); opened++; });
  events.get('moos:open-model-settings')({});
  assert.equal(opened, 1);
  unsubscribe();
  assert.ok(!events.has('moos:open-model-settings'));
  assert.deepEqual(messages, [
    ['moos:pi-usage', null], ['moos:pi-usage', 'session-id'], ['moos:pi-turn', 'session-id', 12], ['moos:pi-active'],
    ['moos:models:list'], ['moos:models:save', draft], ['moos:models:remove', 'relay'],
    ['moos:models:discover', draft], ['moos:models:test', draft],
    ['moos:image-gen:status'], ['moos:image-gen:save', { enabled: true }], ['moos:image-gen:test', { baseUrl: 'https://x/v1' }],
    ['moos:execution-policy:status'], ['moos:execution-policy:save', { mode: 'danger-full-access' }],
  ]);
});
