const fs = require('node:fs');
const { dirname, join } = require('node:path');

// Package paths in the pinned DSH runtime. The workbench still needs core
// Cordis, sessions, filesystem views and plugin installation services.
const removedDshPackages = new Set([
  'tool-executor-native', 'tool-executor-ptc', 'subagent-spawn-in-process', 'subagent-fork-in-process',
  'schedule', 'client-ui-schedule', 'llm-deepseek-api-key', 'llm-deepseek-account', 'llm-pi-ai',
  'client-ui-settings-plugins', 'client-ui-settings-plugin-inventory', 'client-ui-settings-agent-loop',
  'client-ui-settings-shell', 'client-ui-settings-subagent', 'client-ui-settings-web-search',
  'plugin-package-inventory-deepseek', 'api-terminal-controller', 'client-ui-sidebar-terminal',
  'client-ui-sidebar-browser', 'office-to-pdf', 'client-ui-sidebar-documentpreview',
  'web', 'web-search-deepseek', 'web-deepseek-api', 'web-fetch-http', 'mcp-resources',
  'client-ui-skill', 'client-ui-subagent', 'client-ui-workflow-run', 'goal-round-driver',
  'client-ui-goal', 'api-job-controller', 'client-ui-jobs', 'personalized-recommendations',
  'desktop-host', 'skill-office', 'terminal', 'terminal-bash', 'tool-terminal',
  'subagent-claude-code', 'subagent-codex', 'cua-bundle',
  'cordis-host-runner', 'cordis-client-runner', 'tool-cordis', 'client-ui-cordis',
  'harness-dev-context', 'ptc-runtime-node',
]);

function omitted(path) {
  if (path.startsWith('node_modules/@deepseek-ai/')) {
    const name = path.slice('node_modules/@deepseek-ai/'.length);
    return name.startsWith('libreoffice-kit') || name.startsWith('dsh-experimental-') ||
      (name.startsWith('dsh-') && removedDshPackages.has(name.slice(4)));
  }
  return path.startsWith('node_modules/sherpa-onnx-');
}

function patchBundledSource(dsh, packageName, anchor, replacement, { entry = 'index.js', count = 1 } = {}) {
  const file = join(dsh, 'node_modules/@deepseek-ai', packageName, 'lib', entry);
  const source = fs.readFileSync(file, 'utf8');
  if (source.split(anchor).length !== count + 1) throw new Error('Unexpected DSH source in ' + packageName);
  fs.writeFileSync(file, source.replaceAll(anchor, replacement));
}

function configurePiQueue(dsh) {
  // DSH can claim multiple next-step messages at once. PI owns the whole
  // task, so keep one queued input per turn, including calls from old clients.
  patchBundledSource(dsh, 'dsh-agent-loop',
    'steer(input) {\n\t\tthis.send(input, "next-step", true);',
    'steer(input) {\n\t\tthis.followup(input);');
  patchBundledSource(dsh, 'dsh-api-session-controller',
    'if (request.action.kind === "steer" && (target !== "next-turn" || agent.status !== "running"))',
    'if (request.action.kind === "steer")');
  const renderer = { entry: 'client.js' };
  patchBundledSource(dsh, 'dsh-client-ui-conversation',
    'const steeringAvailable = subagent === null || subagent.address.mode === "continuable";',
    'const steeringAvailable = false;', renderer);
  patchBundledSource(dsh, 'dsh-client-ui-conversation',
    'running && steeringAvailable && !disabled && !uploadsPending && plainMessageDraft ? t(primarySubmitMode === "steer" ? "input.send.steer" : "input.send.queue")',
    'running && !disabled && !uploadsPending && plainMessageDraft ? t("input.send.queue")', renderer);
  patchBundledSource(dsh, 'dsh-client-ui-conversation',
    '"aria-label": t("queue.steer"),', '"aria-label": t("queue.steer"), style: { display: "none" },',
    { ...renderer, count: 2 });
  patchBundledSource(dsh, 'dsh-client-ui-conversation',
    'ctx.slots.inject("settings.general.item", () => ctx.slots.register({\n\t\t\t\tname: "settings.general.item",\n\t\t\t\tid: "composer-enter",',
    'false && ctx.slots.inject("settings.general.item", () => ctx.slots.register({\n\t\t\t\tname: "settings.general.item",\n\t\t\t\tid: "composer-enter",',
    renderer);
}

function groupModelsBySite(groups) {
  return groups.flatMap(group => {
    const sites = new Map();
    for (const model of group.models) {
      const site = model.menuSite;
      const key = JSON.stringify([group.id, site?.id ?? null]);
      if (!sites.has(key)) {
        sites.set(key, { ...group, menuKey: key, name: site?.name ?? group.name, models: [] });
      }
      sites.get(key).models.push(model);
    }
    return [...sites.values()];
  });
}

function configureModelPicker(dsh) {
  // Keep the PI route and saved session selection stable. Split only the menus.
  patchBundledSource(dsh, 'dsh-llm', 'const badge = model.badge;\n\t\t\t\treturn {',
    'const badge = model.badge;\n\t\t\t\treturn {\n\t\t\t\t\t...(model.menuSite && { menuSite: { ...model.menuSite } }),');
  patchBundledSource(dsh, 'dsh-api-session-controller', '...reasoning === void 0 ? {} : { reasoning },',
    '...reasoning === void 0 ? {} : { reasoning },\n\t\t\t\t\t...(model.menuSite && { menuSite: model.menuSite }),');
  const picker = 'dsh-client-ui-model-selection';
  const entry = { entry: 'client.js' };
  patchBundledSource(dsh, picker, 'function orderModelProviders(groups) {',
    groupModelsBySite.toString() + '\n\t\tfunction orderModelProviders(groups) {', entry);
  patchBundledSource(dsh, picker, 'orderModelProviders(state.groups).map((group)',
    'groupModelsBySite(orderModelProviders(state.groups)).map((group)', entry);
  patchBundledSource(dsh, picker, '}, group.id);', '}, group.menuKey);', entry);
  patchBundledSource(dsh, picker, 'for (const group of orderModelProviders(directory.groups)) {',
    'for (const group of groupModelsBySite(orderModelProviders(directory.groups))) {', entry);
  patchBundledSource(dsh, picker, 'name: group.id,\n\t\t\t\t\t\tlabel: name',
    'name: group.menuKey,\n\t\t\t\t\t\tlabel: name', entry);
}

function configureModelSettings(dsh) {
  const entry = { entry: 'client.js' };
  const models = 'dsh-client-ui-settings-models';
  patchBundledSource(dsh, models, 'ctx.slots.inject("settings.section", () => ctx.slots.register({',
    'if (!window.moosModelSettings) ctx.slots.inject("settings.section", () => ctx.slots.register({', entry);
  patchBundledSource(dsh, models, 'exports.refreshIfLoaded = refreshIfLoaded;',
    'exports.refreshIfLoaded = refreshIfLoaded;\n\t\texports.moosEditor = { ModelsSection, CustomProviderCard, styles: ModelsSection_module_css_default };', entry);
  patchBundledSource(dsh, models, 'function renderProviderEditor({ target, row, ...props }) {',
    'function renderProviderEditor({ target, row, ...props }) {\n\t\t\tif (props.operations.moosEditor) return props.operations.moosEditor(row.connection, props);', entry);
  patchBundledSource(dsh, models, 'const protocols = protocolChoices(piAi, schema);',
    'const protocols = operations.moosEditor ? ["openai-responses", "openai-completions"] : protocolChoices(piAi, schema);', entry);
  patchBundledSource(dsh, models, 'const reasoningLevels = reasoningLevelChoices(piAi, schema);',
    'const reasoningLevels = operations.moosEditor ? [] : reasoningLevelChoices(piAi, schema);', entry);
  patchBundledSource(dsh, models, 'const catalogOffered = configurable.length > 0;',
    'const catalogOffered = !operations.moosEditor && configurable.length > 0;', entry);
  patchBundledSource(dsh, models, 'children: (0, react_jsx_runtime.jsx)(CustomProviderCard, {',
    'children: (0, react_jsx_runtime.jsx)(operations.moosNewEditor ?? CustomProviderCard, {', entry);
  patchBundledSource(dsh, models,
    'deleteTarget.credentialRef === void 0 ? t("deleteDescription") : t("deleteDescriptionWithCredential")',
    '!operations.moosEditor && deleteTarget.credentialRef === void 0 ? t("deleteDescription") : t("deleteDescriptionWithCredential")', entry);
  patchBundledSource(dsh, models, 'reasoningLevels: props.reasoningLevels,',
    'reasoningLevels: props.reasoningLevels,\n\t\t\t\t\t\t\trenderExtra: props.renderExtra,', entry);
  patchBundledSource(dsh, models, 'const pickedByDefault = (id) => configuredIds.size === 0 || configuredIds.has(id);',
    'const pickedByDefault = (id) => props.pickAllOnEmpty !== false && configuredIds.size === 0 || configuredIds.has(id);', entry);
  patchBundledSource(dsh, models, 'modelField("name"),',
    'modelField("name"),\n\t\t\t\t\t\tprops.renderExtra?.(model, position, props.onFieldChange, disabled),', entry);
  patchBundledSource(dsh, 'dsh-client-ui-conversation',
    '"image.modelUnsupported": "当前模型不支持图片，请切换支持图片的模型"',
    '"image.modelUnsupported": "当前模型未启用图片输入；请在设置 → 模型中确认并启用，或切换到已启用图片的模型"', entry);
  configureProviderCard(dsh, models, entry);
  patchBundledSource(dsh, 'dsh-client-ui-settings-general', 'const shellInstance = shellHandle.create();',
    'const shellInstance = shellHandle.create();\n' +
    '\t\t\t\tconst offMoosModels = window.moosModelSettings?.onOpen(() => {\n' +
    '\t\t\t\t\tshellInstance.actions.open();\n\t\t\t\t\tshellInstance.actions.select("models");\n\t\t\t\t});', entry);
  patchBundledSource(dsh, 'dsh-client-ui-settings-general', 'disposeCommand();',
    'offMoosModels?.();\n\t\t\t\t\tdisposeCommand();', entry);
  patchBundledSource(dsh, 'dsh-client-ui-chat', 'exports.EMPTY_CHAT_SNAPSHOT = EMPTY_CHAT_SNAPSHOT;',
    'exports.EMPTY_CHAT_SNAPSHOT = EMPTY_CHAT_SNAPSHOT;\n\t\texports.TurnUsagePanel = TurnUsagePanel;', entry);
  const usage = 'dsh-client-ui-chat';
  patchBundledSource(dsh, usage, 'function TurnUsagePanel({ usage, t }) {',
    'function TurnUsagePanel({ usage, t, embedded = false }) {\n' +
    '\t\t\tconst mount = panel => embedded ? panel : (0, react_dom.createPortal)(panel, document.body);', entry);
  patchBundledSource(dsh, usage,
    'className: TurnUsagePanel_module_css_default.root,\n\t\t\t\tchildren: [(0, react_jsx_runtime.jsxs)("button", {',
    'className: TurnUsagePanel_module_css_default.root,\n\t\t\t\tstyle: embedded ? { display: "block" } : undefined,\n' +
    '\t\t\t\tchildren: [!embedded && (0, react_jsx_runtime.jsxs)("button", {', entry);
  patchBundledSource(dsh, usage,
    '}), open && (0, react_dom.createPortal)((0, react_jsx_runtime.jsxs)("div", {\n\t\t\t\t\tref: panelRef,\n\t\t\t\t\tclassName: stat_dialog_module_css_default.panel,\n\t\t\t\t\trole: "dialog",\n\t\t\t\t\t"aria-label": t("message.turnUsage.title"),\n\t\t\t\t\tstyle: pos ?? MEASURE_STYLE,',
    '}), (embedded || open) && mount((0, react_jsx_runtime.jsxs)("div", {\n\t\t\t\t\tref: panelRef,\n' +
    '\t\t\t\t\tclassName: stat_dialog_module_css_default.panel,\n\t\t\t\t\trole: embedded ? "region" : "dialog",\n' +
    '\t\t\t\t\t"aria-label": t("message.turnUsage.title"),\n\t\t\t\t\tstyle: embedded ? { position: "static", width: "100%", maxWidth: "none" } : pos ?? MEASURE_STYLE,', entry);
  patchBundledSource(dsh, usage,
    '}), document.body)]\n\t\t\t});\n\t\t}\n\t\t//#endregion\n\t\t//#region lib/types/client/chat/turn-assistant.js',
    '}))]\n\t\t\t});\n\t\t}\n\t\t//#endregion\n\t\t//#region lib/types/client/chat/turn-assistant.js', entry);
}

function configureTurnProcess(dsh) {
  const chat = 'dsh-client-ui-chat';
  const entry = { entry: 'client.js' };
  patchBundledSource(dsh, chat, 'function TurnProcessNodeView({ node, turnProcess, t }) {',
    'function TurnProcessNodeView({ node, turnProcess, t, renderSlot }) {\n' +
    '\t\t\tconst turn = node.location.kind === "turn" || node.location.kind === "step" ? node.location.turn : void 0;\n' +
    '\t\t\treturn (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [\n' +
    '\t\t\t\tturn?.start === void 0 ? null : renderSlot("conversation.chat.turnProcess", {\n' +
    '\t\t\t\t\tstartSeq: turn.start.seq, live: turn.status !== "closed"\n' +
    '\t\t\t\t}), settledTurnProcess(node, turnProcess, t)\n' +
    '\t\t\t] });\n\t\t});\n' +
    '\t\tfunction settledTurnProcess(node, turnProcess, t) {', entry);
  patchBundledSource(dsh, chat, '\t\t});\n\t\t//#endregion\n\t\t//#region lib/types/client/chat/token-format.js',
    '\t\t}\n\t\t//#endregion\n\t\t//#region lib/types/client/chat/token-format.js', entry);
  patchBundledSource(dsh, chat, 'key: "turn-process",\n\t\t\t\tlocale: NS',
    'key: "turn-process",\n\t\t\t\tlocale: NS,\n\t\t\t\tchildren: {\n' +
    '\t\t\t\t\t"conversation.chat.turnProcess": { kind: "list", scope: "session" }\n' +
    '\t\t\t\t}', entry);
}

function configureProviderCard(dsh, packageName, entry) {
  const path = join(dsh, 'node_modules/@deepseek-ai', packageName, 'lib', entry.entry);
  const source = fs.readFileSync(path, 'utf8');
  const start = source.indexOf('function CustomProviderCard(props) {');
  const end = source.indexOf('//#region lib/types/client/ProviderEditor.js', start);
  if (start < 0 || end < 0) throw new Error('Unexpected DSH provider editor');
  let card = source.slice(start, end);
  const patch = (anchor, replacement) => {
    if (card.split(anchor).length !== 2) throw new Error('Unexpected DSH provider editor anchor: ' + anchor);
    card = card.replace(anchor, replacement);
  };
  patch('const [openedAt]', 'const moos = props.moos;\n\t\t\tconst existing = moos?.connection;\n\t\t\tconst [openedAt]');
  for (const [name, setter, initial, field] of [
    ['route', 'setRoute', '""', 'id'],
    ['displayName', 'setDisplayName', '""', 'name'],
    ['baseURL', 'setBaseURL', '""', 'baseUrl'],
    ['protocol', 'setProtocol', 'protocols[0] ?? ""', 'api'],
    ['models', 'setModels', '[]', 'models'],
  ]) {
    const before = `const [${name}, ${setter}] = (0, react.useState)(`;
    patch(before + initial + ');', before + `existing?.${field} ?? (${initial}));`);
  }
  patch('const [keyDraft, setKeyDraft]', 'const [service, setService] = (0, react.useState)(existing?.service ?? "openai");\n\t\t\tconst [keyDraft, setKeyDraft]');
  patch('const routeInvalid = route.length', 'const routeInvalid = !existing && route.length');
  patch('const routeTaken = taken.includes(route);', 'const routeTaken = !existing && taken.includes(route);');
  patch('const disabled = props.readOnly || busy;', 'const disabled = props.readOnly || busy || (moos && listBusy);');
  patch('const ready = route.length', 'const ready = (!moos || !!existing || keyValue.length > 0) && route.length');
  patch('const createOnce = async () => {',
    'const connection = { id: existing?.id, route, name: displayName.trim() || route, baseUrl: normalizedBaseURL, api: protocol, service, apiKey: keyValue, models };\n' +
    '\t\t\tconst createOnce = async () => {\n\t\t\t\tif (moos) return moos.save(connection);');
  patch('placeholder: "acme-gateway",\n\t\t\t\t\t\t\t"aria-label": t("customRoute"),\n\t\t\t\t\t\t\tdisabled: profileDisabled,',
    'placeholder: "acme-gateway",\n\t\t\t\t\t\t\t"aria-label": t("customRoute"),\n\t\t\t\t\t\t\tdisabled: profileDisabled || !!existing,');
  patch('className: ModelsSection_module_css_default["editor"],',
    'className: ModelsSection_module_css_default["editor"],\n\t\t\t\t"data-moos-provider-card": moos ? "" : undefined,');
  patch('value: protocol,\n\t\t\t\t\t\t\t"aria-label": t("customApi"),\n\t\t\t\t\t\t\tdisabled: profileDisabled,',
    'value: protocol,\n\t\t\t\t\t\t\t"aria-label": t("customApi"),\n\t\t\t\t\t\t\tdisabled: profileDisabled || (moos && service === "deepseek"),');
  patch('(0, react_jsx_runtime.jsx)(ModelListEditor, {',
    'moos?.serviceField(service, next => {\n\t\t\t\t\t\tsetService(next);\n\t\t\t\t\t\tif (next === "deepseek") setProtocol("openai-completions");\n\t\t\t\t\t}, profileDisabled),\n' +
    '\t\t\t\t\t(0, react_jsx_runtime.jsx)(ModelListEditor, {');
  patch('onChange: setModels,\n\t\t\t\t\t\treasoningLevels,',
    'onChange: setModels,\n\t\t\t\t\t\treasoningLevels,\n\t\t\t\t\t\trenderExtra: moos ? (model, position, change, disabled) => moos.modelExtra(model, position, change, disabled, service) : undefined,\n\t\t\t\t\t\tpickAllOnEmpty: !moos,\n\t\t\t\t\t\tdefaultInput: moos ? ["text"] : undefined,');
  patch('probeBlocked: baseUrlInvalid ? "customBaseUrlInvalid" : keyFailure === "keyBlank" ? "keyBlankNew" : keyFailure,\n\t\t\t\t\t\toperations,',
    'probeBlocked: baseUrlInvalid ? "customBaseUrlInvalid" : keyFailure === "keyBlank" ? "keyBlankNew" : keyFailure,\n' +
    '\t\t\t\t\t\toperations: moos ? { discoverModels: () => moos.discover(connection) } : operations,');
  patch('(0, react_jsx_runtime.jsx)(EditorFooter, {', 'moos?.testField(connection, disabled),\n\t\t\t\t\t(0, react_jsx_runtime.jsx)(EditorFooter, {');
  patch('submitLabelKey: "create",', 'submitLabelKey: existing ? "apply" : "create",');
  patch('submitBusyLabelKey: "creating",', 'submitBusyLabelKey: existing ? "applying" : "creating",');
  fs.writeFileSync(path, source.slice(0, start) + card + source.slice(end));
}

function stageDshRuntime(resources, destination) {
  const source = join(resources, 'app.asar', 'dsh');
  const dsh = join(destination, 'dsh');
  function copy(path) {
    if (omitted(path)) return;
    const from = join(source, path);
    const to = join(dsh, path);
    const stat = fs.statSync(from);
    if (stat.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      for (const entry of fs.readdirSync(from)) copy(path ? path + '/' + entry : entry);
    } else if (stat.isFile()) {
      // Electron's ASAR filesystem transparently reads unpacked native files.
      fs.writeFileSync(to, fs.readFileSync(from), { mode: stat.mode & 0o777 });
    } else {
      throw new Error('Unsupported DSH runtime entry: ' + path);
    }
  }
  copy('');
  configurePiQueue(dsh);
  configureModelPicker(dsh);
  configureModelSettings(dsh);
  configureTurnProcess(dsh);
  // The Host and the registry must use the same adapter factory instance.
  const adapterDir = join(dsh, 'moos-pi');
  fs.mkdirSync(adapterDir);
  for (const file of ['pi-route.js', 'pi-fork.js']) {
    fs.copyFileSync(join(__dirname, 'plugin', file), join(adapterDir, file));
  }
  const llm = 'dsh-llm';
  const registration = 'prepareRoutes(providers, adapter, owned) {\n\t\t\tconst unique';
  patchBundledSource(dsh, llm, registration, 'prepareRoutes(providers, adapter, owned) {\n' +
    '\t\t\tif (!isMoosPiAdapter(adapter) || providers.some(provider => provider !== moosPiRoute)) {\n' +
    '\t\t\t\tthrow new LlmError("MuMa（沐码）模型服务必须通过 PI 接入", "INVALID_ADAPTER");\n' +
    '\t\t\t}\n\t\t\tconst unique');
  const llmEntry = join(dsh, 'node_modules/@deepseek-ai', llm, 'lib/index.js');
  fs.writeFileSync(llmEntry,
    'import { isMoosPiAdapter, route as moosPiRoute } from "../../../../moos-pi/pi-route.js";\n' +
    fs.readFileSync(llmEntry, 'utf8'));
  // PI reads explicit uploads through the verified attachment store. A host
  // path would be outside the workspace and inaccessible to confined tools.
  const projection = 'if (projectedMessages.some((message) => contentHasFile(message.content)))';
  patchBundledSource(dsh, 'dsh-llm', projection,
    'if (resolvedOptions.provider !== "moos-pi" && projectedMessages.some((message) => contentHasFile(message.content)))');
  // Keep catalog metadata for explicitly installed bundles, but only enumerate
  // bundles already present in the profile or installation.
  const shipped = '...Object.keys(installation.dependencies ?? {})';
  patchBundledSource(dsh, 'dsh-plugin-manager', shipped + ',\n\t\t\t\t...catalog.keys()', shipped);
  // The CLI package is the install anchor the plugin manager reads. Leaving
  // removed bundles there would render them as broken preinstalled plugins.
  for (const file of ['package.json', 'node_modules/@deepseek-ai/dsh/package.json']) {
    const manifestPath = join(dsh, file);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const name of Object.keys(manifest.dependencies)) {
      if (omitted('node_modules/' + name)) delete manifest.dependencies[name];
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  }
  const inventoryPath = join(dsh, 'desktop-runtime.json');
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  inventory.sharedPackages = inventory.sharedPackages.filter(entry => !omitted(entry.path));
  fs.writeFileSync(inventoryPath, JSON.stringify(inventory, null, 2) + '\n');
  for (const entry of ['bin/node', 'primary-runtime/dependencies/pnpm']) {
    const target = join(destination, 'runtime', entry);
    fs.mkdirSync(dirname(target), { recursive: true });
    fs.cpSync(join(resources, 'runtime', entry), target, { recursive: true });
  }
}

module.exports = { stageDshRuntime, configurePiQueue, groupModelsBySite };
if (require.main === module) stageDshRuntime(process.resourcesPath, process.argv[2]);
