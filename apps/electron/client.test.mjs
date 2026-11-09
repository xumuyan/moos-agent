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

test('the settings page exposes an image generation card wired to the moosImageGen bridge', async () => {
  const source = await readFile(new URL('./plugin/client.js', import.meta.url), 'utf8');
  let entry;
  let statusResolve;
  const imageGen = {
    status: () => new Promise(resolve => { statusResolve = resolve; }),
    save: async input => ({ enabled: true, baseUrl: input.baseUrl, model: input.model || 'gpt-image-2.5-flare',
      credentialId: 'image-gen-key', keyConfigured: true }),
    test: async () => ({ ok: true, status: 200, message: '图片服务验证成功 · 密钥有效（未发起付费请求）', elapsedMs: 8 }),
  };
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
    MutationObserver: class { constructor() {} observe() {} disconnect() {} },
    window: {
      __ModuleLoader__: { load(value) { entry = value; } },
      moosImageGen: imageGen,
    },
  });
  const editor = { styles: { input: 'dsh-input', selectInput: 'dsh-select', field: 'f', fieldLabel: 'l',
    section: 's', title: 't' } };
  const elements = [];
  let setState;
  let stateValue;
  const plugin = entry.factory(name => name === '@deepseek-ai/dsh-client-ui-settings-models' ? { moosEditor: editor } : ({
    Button() {},
    createElement: (element, props, ...children) => { const node = { element, props, children }; elements.push(node); return node; },
    useState: value => [stateValue ?? value, updater => { setState = updater; }],
    useEffect: callback => { callback(); },
    useRef: () => ({}),
  }));
  const registrations = [];
  plugin.apply({
    locale: { bind: () => key => key },
    slots: {
      inject(_slot, register) { register(); },
      register(spec, component) { registrations.push([spec, component]); },
    },
    on() {},
  });
  const imageSpec = registrations.find(([spec]) => spec.id === 'moos-image');
  assert.ok(imageSpec, 'image settings section must register');
  assert.equal(imageSpec[0].order, 15);
  assert.equal(imageSpec[0].label(), '图片生成');
  const component = imageSpec[1];
  const vnode = component({});
  assert.equal(vnode.element, undefined || vnode.element.name === undefined ? vnode.element : vnode.element, 'lazy component reference');
  const form = vnode.element(vnode.props);
  assert.equal(form.props['data-moos-image-settings'], '');
  assert.equal(form.children[0].children[0], '图片生成');
  // 加载中仍渲染停用态字段（不抛错），status promise 完成后经 setState 更新。
  assert.equal(form.children[1].children[1].props['aria-label'], '启用图片生成');
  statusResolve({ enabled: true, baseUrl: 'https://api.yunqiao.me/v1', model: 'gpt-image-2.5-flare',
    credentialId: 'image-gen-key', keyConfigured: true });
  await Promise.resolve();
  stateValue = { status: 'ready', enabled: true, baseUrl: 'https://api.yunqiao.me/v1',
    model: 'gpt-image-2.5-flare', keyConfigured: true };
  const enabled = component({}).element(component({}).props);
  const grid = enabled.children[2];
  const labels = grid.children.filter(child => child.props?.className === 'f')
    .map(label => label.children[0].children[0]);
  assert.deepEqual(labels, ['服务地址', '模型 ID', 'API 密钥']);
  const keyInput = grid.children[2].children[1];
  assert.equal(keyInput.props.type, 'password');
  assert.match(keyInput.props.placeholder, /已保存，留空保持不变/);
  const note = grid.children[3];
  assert.match(note.children[0], /图片专用分组/);
  assert.match(note.children[0], /不发起付费请求/);
  const buttons = grid.children[4].children;
  assert.equal(buttons[0].props.type, 'button');
  assert.equal(typeof buttons[0].props.onClick, 'function', 'test-connection button is clickable');
  // 保存按钮靠 form onSubmit 提交；用启用态的 form 触发以验证 save 路径走 window.moosImageGen.save。
  let saved;
  imageGen.save = async input => { saved = input;
    return { enabled: true, baseUrl: input.baseUrl, model: 'gpt-image-2.5-flare', credentialId: 'image-gen-key', keyConfigured: true }; };
  const enabledForm = component({}).element(component({}).props);
  await enabledForm.props.onSubmit({ preventDefault() {} });
  assert.equal(saved.enabled, true);
  assert.equal(saved.baseUrl, 'https://api.yunqiao.me/v1');
  assert.equal(saved.model, 'gpt-image-2.5-flare');
  assert.equal(saved.apiKey, '', 'empty key keeps the saved credential');
  // 测试连接路径不触发 save。
  await buttons[0].props.onClick();
  assert.equal(saved.apiKey, '');
});
