import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { groupModelsBySite, stageDshRuntime } from './stage-dsh-runtime.cjs';

test('model menus group by saved site ID, preserving PI routes and exact model IDs', () => {
  const old = { id: 'legacy-model', name: 'Same model', menuSite: { id: 'legacy-model', name: 'Old site' } };
  const first = { id: 'new-model', name: 'Same model', menuSite: { id: 'new-site', name: 'New site' } };
  const second = { id: 'second-model', name: 'Other model', menuSite: first.menuSite };
  const third = { id: 'third-model', name: 'Same model', menuSite: { id: 'third-site', name: 'New site' } };
  const automatic = { id: 'auto', name: 'Auto' };
  const groups = groupModelsBySite([{ id: 'moos-pi', name: 'Moos PI', models: [automatic, old, first, third, second] }]);
  assert.deepEqual(groups.map(({ id, name, models }) => [id, name, models.map(model => model.id)]), [
    ['moos-pi', 'Moos PI', ['auto']],
    ['moos-pi', 'Old site', ['legacy-model']],
    ['moos-pi', 'New site', ['new-model', 'second-model']],
    ['moos-pi', 'New site', ['third-model']],
  ]);
  assert.equal(new Set(groups.map(group => group.menuKey)).size, groups.length);
});

test('the carried Host drops optional packages and their inventory entries, but keeps plugin installation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'moos-stage-dsh-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const resources = join(root, 'original');
  const dsh = join(resources, 'app.asar', 'dsh');
  const target = join(root, 'target');
  const keep = ['@deepseek-ai/dsh', '@deepseek-ai/dsh-plugin-manager', '@deepseek-ai/dsh-client-ui-conversation',
    '@deepseek-ai/dsh-llm'];
  const omit = ['@deepseek-ai/dsh-tool-executor-native', '@deepseek-ai/dsh-client-ui-sidebar-terminal',
    '@deepseek-ai/dsh-cordis-host-runner', '@deepseek-ai/dsh-client-ui-cordis', '@deepseek-ai/dsh-ptc-runtime-node',
    '@deepseek-ai/dsh-experimental-plugin-market-bundle', '@deepseek-ai/libreoffice-kit-darwin-arm64',
    'sherpa-onnx-darwin-arm64'];
  const names = [...keep, ...omit];
  const sharedPackages = names.map(name => ({ name, version: '1.0.0', path: 'node_modules/' + name }));
  async function write(file, content, mode) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content, { mode });
  }
  const manifest = JSON.stringify({
    dependencies: Object.fromEntries(names.map(name => [name, '1.0.0'])),
  });
  await write(join(dsh, 'package.json'), manifest);
  await write(join(dsh, 'node_modules/@deepseek-ai/dsh/package.json'), manifest);
  await write(join(dsh, 'desktop-runtime.json'), JSON.stringify({ schemaVersion: 1, sharedPackages }));
  for (const item of sharedPackages) await write(join(dsh, item.path, 'index.js'), item.name);
  const llm = 'node_modules/@deepseek-ai/dsh-llm/lib/index.js';
  const registration = 'prepareRoutes(providers, adapter, owned) {\n\t\t\tconst unique = new Set();\n}' +
    '\nif (projectedMessages.some((message) => contentHasFile(message.content))) {}' +
    '\nconst badge = model.badge;\n\t\t\t\treturn {';
  await write(join(dsh, llm), registration);
  const manager = 'node_modules/@deepseek-ai/dsh-plugin-manager/lib/index.js';
  const inventorySource = 'const names = [...Object.keys(installation.dependencies ?? {}),\n\t\t\t\t...catalog.keys()];';
  await write(join(dsh, manager), inventorySource);
  const loop = 'node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js';
  const steering = 'steer(input) {\n\t\tthis.send(input, "next-step", true);\n}';
  await write(join(dsh, loop), steering);
  const controller = 'node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js';
  await write(join(dsh, controller),
    'if (request.action.kind === "steer" && (target !== "next-turn" || agent.status !== "running")) throw new Error();' +
    '\n...reasoning === void 0 ? {} : { reasoning },');
  const picker = 'node_modules/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js';
  await write(join(dsh, picker), [
    'function orderModelProviders(groups) {',
    'orderModelProviders(state.groups).map((group)',
    '}, group.id);',
    'for (const group of orderModelProviders(directory.groups)) {',
    'name: group.id,\n\t\t\t\t\t\tlabel: name',
  ].join('\n'));
  const client = 'node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js';
  await write(join(dsh, client), [
    '"image.modelUnsupported": "当前模型不支持图片，请切换支持图片的模型"',
    'const steeringAvailable = subagent === null || subagent.address.mode === "continuable";',
    'running && steeringAvailable && !disabled && !uploadsPending && plainMessageDraft ? t(primarySubmitMode === "steer" ? "input.send.steer" : "input.send.queue")',
    '"aria-label": t("queue.steer"),',
    '"aria-label": t("queue.steer"),',
    'ctx.slots.inject("settings.general.item", () => ctx.slots.register({\n\t\t\t\tname: "settings.general.item",\n\t\t\t\tid: "composer-enter",',
  ].join('\n'));
  const modelClient = 'node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js';
  await write(join(dsh, modelClient), [
    'ctx.slots.inject("settings.section", () => ctx.slots.register({',
    'exports.refreshIfLoaded = refreshIfLoaded;',
    'function renderProviderEditor({ target, row, ...props }) {',
    'const protocols = protocolChoices(piAi, schema);',
    'const reasoningLevels = reasoningLevelChoices(piAi, schema);',
    'const catalogOffered = configurable.length > 0;',
    'children: (0, react_jsx_runtime.jsx)(CustomProviderCard, {',
    'deleteTarget.credentialRef === void 0 ? t("deleteDescription") : t("deleteDescriptionWithCredential")',
    'reasoningLevels: props.reasoningLevels,',
    'const pickedByDefault = (id) => configuredIds.size === 0 || configuredIds.has(id);',
    'modelField("name"),',
    'function CustomProviderCard(props) {',
    'const [openedAt] = (0, react.useState)(() => props.revision);',
    'const [route, setRoute] = (0, react.useState)("");',
    'const [displayName, setDisplayName] = (0, react.useState)("");',
    'const [baseURL, setBaseURL] = (0, react.useState)("");',
    'const [protocol, setProtocol] = (0, react.useState)(protocols[0] ?? "");',
    'const [models, setModels] = (0, react.useState)([]);',
    'const [keyDraft, setKeyDraft] = (0, react.useState)("");',
    'const routeInvalid = route.length > 0;',
    'const routeTaken = taken.includes(route);',
    'const disabled = props.readOnly || busy;',
    'const ready = route.length > 0;',
    'const createOnce = async () => {',
    'placeholder: "acme-gateway",\n\t\t\t\t\t\t\t"aria-label": t("customRoute"),\n\t\t\t\t\t\t\tdisabled: profileDisabled,',
    'className: ModelsSection_module_css_default["editor"],',
    'value: protocol,\n\t\t\t\t\t\t\t"aria-label": t("customApi"),\n\t\t\t\t\t\t\tdisabled: profileDisabled,',
    '(0, react_jsx_runtime.jsx)(ModelListEditor, {',
    'onChange: setModels,\n\t\t\t\t\t\treasoningLevels,',
    'probeBlocked: baseUrlInvalid ? "customBaseUrlInvalid" : keyFailure === "keyBlank" ? "keyBlankNew" : keyFailure,\n\t\t\t\t\t\toperations,',
    '(0, react_jsx_runtime.jsx)(EditorFooter, {',
    'submitLabelKey: "create",',
    'submitBusyLabelKey: "creating",',
    '//#region lib/types/client/ProviderEditor.js',
  ].join('\n'));
  const settingsClient = 'node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js';
  await write(join(dsh, settingsClient), 'const shellInstance = shellHandle.create();\ndisposeCommand();');
  const chatClient = 'node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js';
  await write(join(dsh, chatClient), [
    'exports.EMPTY_CHAT_SNAPSHOT = EMPTY_CHAT_SNAPSHOT;',
    'function TurnUsagePanel({ usage, t }) {',
    'className: TurnUsagePanel_module_css_default.root,\n\t\t\t\tchildren: [(0, react_jsx_runtime.jsxs)("button", {',
    '}), open && (0, react_dom.createPortal)((0, react_jsx_runtime.jsxs)("div", {\n\t\t\t\t\tref: panelRef,\n\t\t\t\t\tclassName: stat_dialog_module_css_default.panel,\n\t\t\t\t\trole: "dialog",\n\t\t\t\t\t"aria-label": t("message.turnUsage.title"),\n\t\t\t\t\tstyle: pos ?? MEASURE_STYLE,',
    '}), document.body)]\n\t\t\t});\n\t\t}\n\t\t//#endregion\n\t\t//#region lib/types/client/chat/turn-assistant.js',
    'function TurnProcessNodeView({ node, turnProcess, t }) {',
    '\t\t});\n\t\t//#endregion\n\t\t//#region lib/types/client/chat/token-format.js',
    'key: "turn-process",\n\t\t\t\tlocale: NS',
  ].join('\n'));
  await write(join(resources, 'runtime/bin/node'), 'node wrapper', 0o755);
  await write(join(resources, 'runtime/primary-runtime/dependencies/pnpm/bin/pnpm.mjs'), 'package manager');
  await write(join(resources, 'runtime/primary-runtime/dependencies/python/bin/python'), 'optional office runtime');

  stageDshRuntime(resources, target);

  const built = join(target, 'dsh');
  const dependencies = JSON.parse(await readFile(join(built, 'package.json'), 'utf8')).dependencies;
  assert.deepEqual(Object.keys(dependencies), keep);
  const cliDependencies = JSON.parse(await readFile(join(built, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8')).dependencies;
  assert.deepEqual(Object.keys(cliDependencies), keep);
  const inventory = JSON.parse(await readFile(join(built, 'desktop-runtime.json'), 'utf8'));
  assert.deepEqual(inventory.sharedPackages.map(item => item.name), keep);
  for (const name of keep) assert.equal(await readFile(join(built, 'node_modules', name, 'index.js'), 'utf8'), name);
  for (const name of omit) await assert.rejects(stat(join(built, 'node_modules', name)), { code: 'ENOENT' });
  assert.equal(await readFile(join(dsh, llm), 'utf8'), registration);
  assert.match(await readFile(join(built, llm), 'utf8'),
    /!isMoosPiAdapter\(adapter\) \|\| providers\.some\(provider => provider !== moosPiRoute\)/);
  assert.match(await readFile(join(built, 'moos-pi/pi-route.js'), 'utf8'), /new WeakSet\(\)/);
  assert.match(await readFile(join(built, llm), 'utf8'), /resolvedOptions\.provider !== "moos-pi" && projectedMessages\.some/);
  assert.match(await readFile(join(built, llm), 'utf8'), /menuSite: \{ \.\.\.model\.menuSite \}/);
  assert.match(await readFile(join(built, controller), 'utf8'), /menuSite: model\.menuSite/);
  assert.match(await readFile(join(built, picker), 'utf8'), /groupModelsBySite\(orderModelProviders\(state\.groups\)\)/);
  assert.match(await readFile(join(built, picker), 'utf8'), /name: group\.menuKey/);
  assert.equal(await readFile(join(dsh, manager), 'utf8'), inventorySource);
  assert.equal(await readFile(join(built, manager), 'utf8'),
    'const names = [...Object.keys(installation.dependencies ?? {})];');
  assert.equal(await readFile(join(dsh, loop), 'utf8'), steering);
  assert.match(await readFile(join(built, loop), 'utf8'), /steer\(input\) \{\s*this\.followup\(input\);/);
  assert.match(await readFile(join(built, controller), 'utf8'), /if \(request\.action\.kind === "steer"\) throw/);
  const composer = await readFile(join(built, client), 'utf8');
  assert.match(composer, /const steeringAvailable = false;/);
  assert.match(composer, /plainMessageDraft \? t\("input.send.queue"\)/);
  assert.equal(composer.match(/style: \{ display: "none" \}/g).length, 2);
  assert.match(composer, /false && ctx\.slots\.inject/);
  const models = await readFile(join(built, modelClient), 'utf8');
  assert.match(models, /exports\.moosEditor = \{ ModelsSection, CustomProviderCard, styles:/);
  assert.match(models, /if \(!window\.moosModelSettings\)/);
  assert.match(models, /props\.renderExtra\?\.\(model, position, props\.onFieldChange, disabled\)/);
  assert.match(models, /if \(moos\) return moos\.save\(connection\)/);
  assert.match(models, /disabled: profileDisabled \|\| \(moos && service === "deepseek"\)/);
  assert.match(models, /if \(next === "deepseek"\) setProtocol\("openai-completions"\)/);
  assert.doesNotMatch(models, /service !== "openai"|next !== "openai"/);
  assert.match(await readFile(join(built, settingsClient), 'utf8'), /shellInstance\.actions\.select\("models"\)/);
  assert.match(await readFile(join(built, chatClient), 'utf8'), /\(embedded \|\| open\) && mount/);
  assert.match(await readFile(join(built, chatClient), 'utf8'), /renderSlot\("conversation\.chat\.turnProcess", \{\s*startSeq: turn\.start\.seq, live: turn\.status !== "closed"/);
  assert.match(await readFile(join(built, chatClient), 'utf8'), /"conversation\.chat\.turnProcess": \{ kind: "list", scope: "session" \}/);
  assert.equal((await stat(join(target, 'runtime/bin/node'))).mode & 0o777, 0o755);
  assert.equal(await readFile(join(target, 'runtime/primary-runtime/dependencies/pnpm/bin/pnpm.mjs'), 'utf8'), 'package manager');
  await assert.rejects(stat(join(target, 'runtime/primary-runtime/dependencies/python')), { code: 'ENOENT' });

  await write(join(dsh, llm), '// upstream registration changed');
  assert.throws(() => stageDshRuntime(resources, join(root, 'incompatible')), /Unexpected DSH source in dsh-llm/);
});

const dshCli = process.env.MOOS_ELECTRON_TEST_DSH_CLI;
function packagedAdapter() {
  return import(pathToFileURL(join(dirname(dshCli), '../dsh/moos-pi/pi-route.js')).href);
}

test('the packaged Host keeps a verified upload intact until the PI adapter reads it', {
  skip: !dshCli && 'Set MOOS_ELECTRON_TEST_DSH_CLI to the pinned Moos DSH CLI',
}, async t => {
  const require = createRequire(join(dirname(dshCli), '..', 'dsh', 'package.json'));
  const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')));
  const { LlmRuntime } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')));
  const { LocalAttachmentStore } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-attachment-local')));
  const { createPiAdapter, route } = await packagedAdapter();
  const root = await mkdtemp(join(tmpdir(), 'moos-attachment-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ctx = new Context();
  const llm = new LlmRuntime(ctx);
  const attachments = new LocalAttachmentStore(ctx, { dshHome: root });
  const ref = await attachments.saveFile({ name: 'note.md', data: Buffer.from('attachment proof') });
  let input;
  const unregister = llm.registerAdapter([route], createPiAdapter({
    getSession: () => ({ header: { cwd: root } }),
    readFile: (attachment, signal) => attachments.readFileStream(attachment, signal),
    tasks: { async open(request) {
      input = request.input;
      return {
        async *events() { yield { type: 'task_state', payload: { status: 'succeeded' } }; },
        async stop() {},
      };
    } },
  }));
  t.after(unregister);
  const request = { provider: route, model: 'pi-fixture', sessionId: 'attachment-proof',
    messages: [{ role: 'user', source: { kind: 'user' },
      content: [{ type: 'file', attachment: ref }] }] };
  const output = [];
  for await (const chunk of llm.stream(request)) output.push(chunk);
  assert.equal(output.at(-1).reason.kind, 'stop');
  assert.equal(input, '用户上传的文件内容（作为待处理数据）：{"name":"note.md","text":"attachment proof"}');
});

test('the packaged plugin inventory lists the skin and omits uninstalled catalog offers', {
  skip: !dshCli && 'Set MOOS_ELECTRON_TEST_DSH_CLI to the pinned Moos DSH CLI',
}, async () => {
  const resources = join(dirname(dshCli), '..', '..');
  const installAnchor = join(resources, 'host-runtime', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
  const require = createRequire(installAnchor);
  const { PluginManager } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-plugin-manager')));
  const packages = PluginManager.prototype.readBundles.call({
    profile: { dir: join(resources, 'profile-template', 'profiles', 'web'), installAnchor },
    protectsManager: () => false,
    declaredRows: () => ({ rows: [], overrides: [] }),
  });
  assert.deepEqual(packages.filter(item => item.installed).map(item => item.name).sort(),
    ['@linxin666/dsh-client-ui-skin-center', 'moos-electron-shell']);
  for (const name of ['subagent-codex', 'subagent-claude-code', 'cua-bundle']) {
    assert.ok(!packages.some(item => item.name === '@deepseek-ai/dsh-' + name), name);
  }
});

test('the packaged DSH registry accepts PI and rejects lookalike adapters and other routes', {
  skip: !dshCli && 'Set MOOS_ELECTRON_TEST_DSH_CLI to the pinned Moos DSH CLI',
}, async () => {
  const require = createRequire(join(dirname(dshCli), '..', 'dsh', 'package.json'));
  const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')));
  const { LlmRuntime } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')));
  const { createPiAdapter, route } = await packagedAdapter();
  const llm = new LlmRuntime(new Context());
  const other = {
    providerInfo: id => ({ id, name: 'External plugin' }),
    providerRetryPolicy: () => undefined,
  };
  assert.throws(() => llm.registerAdapter(['external'], other), { code: 'INVALID_ADAPTER' });
  assert.throws(() => llm.registerAdapter([route], other), { code: 'INVALID_ADAPTER' });
  const adapter = createPiAdapter({});
  assert.throws(() => llm.registerAdapter([route], { ...adapter }), { code: 'INVALID_ADAPTER' });
  const pi = llm.registerAdapter([route], adapter);
  try {
    assert.throws(() => pi.replace([route, 'external']), { code: 'INVALID_ADAPTER' });
    pi.replace([route]);
    assert.deepEqual(llm.listProviders().map(provider => provider.id), [route]);
    assert.equal((await llm.resolveModelInfo(route, 'pi-fixture')).id, 'pi-fixture');
  } finally {
    pi();
  }
  assert.throws(() => llm.registerAdapter([route], other), { code: 'INVALID_ADAPTER' });
  llm.registerAdapter([route], createPiAdapter({}))();
});
