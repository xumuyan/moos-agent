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
  // Both initial registration and replacement pass through this validation.
  const registration = 'prepareRoutes(providers, adapter, owned) {\n\t\t\tconst unique';
  patchBundledSource(dsh, 'dsh-llm', registration, 'prepareRoutes(providers, adapter, owned) {\n' +
    '\t\t\tif (providers.some(provider => provider !== "moos-pi")) {\n' +
    '\t\t\t\tthrow new LlmError("Moos 模型服务必须通过 PI 接入", "INVALID_ADAPTER");\n' +
    '\t\t\t}\n\t\t\tconst unique');
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

module.exports = { stageDshRuntime, configurePiQueue };
if (require.main === module) stageDshRuntime(process.resourcesPath, process.argv[2]);
