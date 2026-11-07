import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('the workbench gets the macOS layout even when fullscreen arrives before the DOM', async () => {
  const code = await readFile(new URL('./window-preload.cjs', import.meta.url), 'utf8');
  const document = { documentElement: null };
  let ready;
  let fullscreen;
  runInNewContext(code, {
    document,
    window: { addEventListener: (event, callback) => {
      assert.equal(event, 'DOMContentLoaded');
      ready = callback;
    } },
    require: name => {
      assert.equal(name, 'electron');
      return { ipcRenderer: { on: (event, callback) => {
        assert.equal(event, 'moos:window-fullscreen');
        fullscreen = callback;
      } } };
    },
  });
  fullscreen({}, true);
  document.documentElement = { dataset: {} };
  ready();
  assert.deepEqual(document.documentElement.dataset, { moosWindow: 'darwin', fullscreen: 'true' });
  fullscreen({}, false);
  assert.deepEqual(document.documentElement.dataset, { moosWindow: 'darwin' });
});
