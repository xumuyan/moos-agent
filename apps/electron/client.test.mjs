import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('the DSH client extension registers the Moos brand and opens model services through its bridge', async () => {
  const source = await readFile(new URL('./plugin/client.js', import.meta.url), 'utf8');
  let entry;
  let changed;
  let cleanedUp = false;
  let dispose;
  let failed = false;
  let calls = 0;
  let reject = false;
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
      async moosOpenModelSettings() {
        calls++;
        if (reject) throw new Error('private IPC error');
      },
    },
  });

  const Button = () => {};
  const plugin = entry.factory(name => name === '@deepseek-ai/dsh-client-ui-primitives' ? { Button } : ({
    createElement: (element, props, ...children) => ({ element, props, children }),
    useState: () => [failed, value => { failed = value; }],
  }));
  assert.ok(plugin.inject.includes('shortcuts'));
  assert.equal(document.documentElement.dataset.platform, undefined);
  const renderers = new Map();
  plugin.apply({
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
  const models = renderers.get('moos-models');
  const button = models().children.find(child => child?.element === Button);
  assert.equal(button.children[0], '管理模型服务');
  assert.equal(button.props.variant, 'outline');
  assert.equal(button.props.size, 'sm');
  await button.props.onClick();
  assert.equal(calls, 1);
  assert.equal(failed, false);
  reject = true;
  await button.props.onClick();
  assert.equal(models().children.find(child => child?.props?.role === 'status').children[0],
    '模型服务窗口未能打开，请重试。');
  assert.equal(document.title, 'Moos');
  document.title = '深海女仆工坊 · DeepSeek Harness';
  changed();
  assert.equal(document.title, '深海女仆工坊 · Moos');
  dispose();
  assert.equal(cleanedUp, true);
  assert.equal(document.documentElement.dataset.platform, undefined);
});
