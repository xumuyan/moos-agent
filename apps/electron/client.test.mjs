import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('the DSH client extension keeps one Moos mark and owns its title changes', async () => {
  const source = await readFile(new URL('./plugin/client.js', import.meta.url), 'utf8');
  let entry;
  let changed;
  let cleanedUp = false;
  let dispose;
  const document = {
    documentElement: { dataset: { moosWindow: 'darwin' } },
    title: 'DeepSeek Harness',
    createElement: () => ({ remove() {} }),
    querySelector: () => ({}),
    head: { append() {} },
  };
  runInNewContext(source, {
    document,
    MutationObserver: class {
      constructor(callback) { changed = callback; }
      observe() {}
      disconnect() { cleanedUp = true; }
    },
    window: { __ModuleLoader__: { load(value) { entry = value; } } },
  });

  const plugin = entry.factory(() => ({ createElement: (element, props, text) => ({ element, props, text }) }));
  assert.ok(plugin.inject.includes('shortcuts'));
  assert.equal(document.documentElement.dataset.platform, undefined);
  const renderers = new Map();
  plugin.apply({
    slots: {
      inject(_slot, register) { register(); },
      register({ name }, component) { renderers.set(name, component); },
    },
    on(event, callback) { if (event === 'dispose') dispose = callback; },
  });
  assert.equal(renderers.get('sidebar.brand.mark')(), null);
  assert.equal(document.documentElement.dataset.platform, 'darwin');
  assert.equal(renderers.get('sidebar.brand.name')(), null);
  assert.equal(renderers.get('conversation.hero.brand.mark')({ size: 34 }).text, 'M');
  assert.equal(document.title, 'Moos');
  document.title = '深海女仆工坊 · DeepSeek Harness';
  changed();
  assert.equal(document.title, '深海女仆工坊 · Moos');
  dispose();
  assert.equal(cleanedUp, true);
  assert.equal(document.documentElement.dataset.platform, undefined);
});
