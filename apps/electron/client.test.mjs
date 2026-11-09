import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('the DSH client extension registers the Moos brand and model services in the original settings section', async () => {
  const source = await readFile(new URL('./plugin/client.js', import.meta.url), 'utf8');
  let entry;
  const modelSettings = {};
  let changed;
  let cleanedUp = false;
  let dispose;
  let turnResult;
  let effect;
  const turnReads = [];
  const document = {
    documentElement: { dataset: { moosWindow: 'darwin' } },
    title: 'DeepSeek Harness',
    createElement: () => ({ remove() {} }),
    querySelector: () => ({}),
    head: { append() {} },
  };
  runInNewContext(source, {
    document,
    clearTimeout,
    MutationObserver: class {
      constructor(callback) { changed = callback; }
      observe() {}
      disconnect() { cleanedUp = true; }
    },
    window: {
      __ModuleLoader__: { load(value) { entry = value; } },
      moosModelSettings: modelSettings,
      moosTurn: (...args) => { turnReads.push(args); },
    },
  });

  const editor = { ModelsSection() {}, CustomProviderCard() {}, styles: { input: 'dsh-input', selectInput: 'dsh-select' } };
  const plugin = entry.factory(name => name === '@deepseek-ai/dsh-client-ui-settings-models' ? { moosEditor: editor } : ({
    Button() {},
    createElement: (element, props, ...children) => ({ element, props, children }),
    useState: value => [turnResult ?? value],
    useEffect: (callback, dependencies) => { effect = { callback, dependencies }; },
    useRef: () => ({}),
  }));
  assert.ok(plugin.inject.includes('shortcuts'));
  assert.equal(document.documentElement.dataset.platform, undefined);
  const renderers = new Map();
  const slots = new Map();
  plugin.apply({
    locale: { bind: () => key => key },
    slots: {
      inject(_slot, register) { register(); },
      register({ name, id }, component) {
        renderers.set(id ?? name, component);
        slots.set(id ?? name, name);
      },
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
  const settings = renderers.get('models')({ renderSlot });
  const section = settings.element(settings.props).children[0];
  const provider = section.props.operations.moosNewEditor({});
  const card = provider.element(provider.props);
  assert.equal(card.element, editor.CustomProviderCard);
  const service = card.props.moos.serviceField('openai', () => {}, false).children[0].children[1];
  assert.equal(service.props.className, 'dsh-input dsh-select');
  assert.equal(service.props.value, 'openai');
  const glmNote = card.props.moos.serviceField('glm', () => {}, false).children[1];
  assert.match(glmNote.children[0], /https:\/\/open.bigmodel.cn\/api\/v1/);
  assert.match(glmNote.children[0], /OpenAI Responses/);
  assert.equal(glmNote.props.style.fontSize, 12);
  assert.match(source, /role: 'status', style: noteStyle/);
  modelSettings.discover = async () => ({ ok: false, message: '模型服务返回格式异常', code: 'protocol' });
  const discovery = await card.props.moos.discover({});
  assert.equal(discovery.kind, 'refused');
  assert.match(discovery.message, /添加模型.*手动.*测试连接/);
  const edits = [];
  const extra = card.props.moos.modelExtra({ id: 'gpt-fixture', input: ['text', 'image'] }, 1,
    (...args) => edits.push(args), false);
  assert.equal(extra.props.style.gridColumn, '1 / -1', 'capabilities must not expand the drag-handle auto column');
  assert.equal(extra.props.style.minWidth, 0);
  assert.equal(extra.children[1].props.style.flexDirection, 'row');
  const image = extra.children[1].children[1];
  assert.equal(image.props.type, 'checkbox');
  assert.equal(image.props.checked, true);
  image.props.onChange({ target: { checked: false } });
  image.props.onChange({ target: { checked: true } });
  assert.deepEqual(Array.from(edits[0][1]), ['text']);
  assert.deepEqual(Array.from(edits[1][1]), ['text', 'image']);
  const off = card.props.moos.modelExtra({ id: 'unknown-gpt' }, 2, () => {}, true).children[1].children[1];
  assert.equal(off.props.checked, false, 'never infer image capability from the model name');
  assert.equal(off.props.disabled, true);
  const glmSelect = card.props.moos.modelExtra({ id: 'glm-fixture', input: ['text'] }, 3, () => {}, false, 'glm')
    .children[0].children[1].children[0];
  assert.deepEqual(Array.from(glmSelect, option => [option.props.value, option.children[0]]),
    [['off', '关闭'], ['low', 'Low · 轻度思考'], ['high', 'High · 增强思考'], ['max', 'Max · 深度思考']],
    'GLM must offer only the official low/high/max efforts');
  const relaySelect = card.props.moos.modelExtra({ id: 'relay-fixture', input: ['text'] }, 4, () => {}, false, 'openai')
    .children[0].children[1].children[0];
  assert.equal(relaySelect.length, 6, 'non-GLM keeps the OpenAI-style levels');

  assert.equal(slots.get('moos-pi-process'), 'conversation.chat.turnProcess');
  assert.equal(slots.get('moos-pi-turn'), 'conversation.chat.turnTail');
  assert.equal(slots.get('moos-pi-retry'), 'conversation.composer.dock');
  assert.equal(slots.has('moos-pi-live'), false);
  turnResult = { sessionId: 'test-session', startSeq: 12,
    data: { status: 'running', actions: [{ label: '运行命令', state: 'running' }], files: [] } };
  const process = renderers.get('moos-pi-process')({ sessionId: 'test-session', startSeq: 12, live: true });
  assert.equal(process.element(process.props).element, 'details');
  assert.deepEqual(Array.from(effect.dependencies), ['test-session', 12, true]);
  effect.callback()();
  assert.deepEqual(turnReads, [['test-session', 12]]);
  const tail = renderers.get('moos-pi-turn');
  const tailProps = { sessionId: 'test-session', turn: { start: { seq: 12 } } };
  assert.equal(tail(tailProps), null);
  turnResult.data.files.push({ path: 'result.txt', summary: '新增' });
  assert.equal(tail(tailProps).children[0].element, 'section');

  assert.equal(document.title, 'Moos');
  document.title = '深海女仆工坊 · DeepSeek Harness';
  changed();
  assert.equal(document.title, '深海女仆工坊 · Moos');
  dispose();
  assert.equal(cleanedUp, true);
  assert.equal(document.documentElement.dataset.platform, undefined);
});
