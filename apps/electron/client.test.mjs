import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('the DSH client extension registers the Moos brand and model services in the original settings section', async () => {
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
    window: {
      __ModuleLoader__: { load(value) { entry = value; } },
      moosModelSettings: {},
    },
  });

  const editor = { ModelListEditor() {}, styles: {} };
  const plugin = entry.factory(name => name === '@deepseek-ai/dsh-client-ui-settings-models' ? { moosEditor: editor } : ({
    Button() {},
    createElement: (element, props, ...children) => ({ element, props, children }),
  }));
  assert.ok(plugin.inject.includes('shortcuts'));
  assert.equal(document.documentElement.dataset.platform, undefined);
  const renderers = new Map();
  plugin.apply({
    locale: { bind: () => key => key },
    slots: {
      inject(_slot, register) { register(); },
      register({ name, id }, component) { renderers.set(id ?? name, component); },
    },
    on(event, callback) { if (event === 'dispose') dispose = callback; },
  });
  const icon = renderers.get('sidebar.brand.mark')({ size: 24 });
  assert.equal(icon.element, 'img');
  assert.equal(icon.props.width, 24);
  assert.match(icon.props.src, /^data:image\/png;base64,/);
  assert.equal(document.documentElement.dataset.platform, 'darwin');
  assert.equal(renderers.get('sidebar.brand.name')().children[0], 'Moos');
  assert.equal(renderers.get('conversation.hero.brand.mark')({ size: 34 }).children[0], 'M');
  const renderSlot = () => null;
  assert.equal(renderers.get('models')({ renderSlot }).props.editor, editor);
  assert.equal(renderers.get('models')({ renderSlot }).props.renderSlot, renderSlot);
  assert.equal(renderers.get('models')({ renderSlot }).props.t('addModel'), 'addModel');
  assert.equal(document.title, 'Moos');
  document.title = '深海女仆工坊 · DeepSeek Harness';
  changed();
  assert.equal(document.title, '深海女仆工坊 · Moos');
  dispose();
  assert.equal(cleanedUp, true);
  assert.equal(document.documentElement.dataset.platform, undefined);
});
