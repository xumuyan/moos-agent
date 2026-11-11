// 打包清单防回归：sdk-runtime 相对导入的本地模块必须全部进入安装包清单。
// 运行：node --test apps/electron/packaging.test.mjs
// 背景：P03.13.9 引入 packages/pi-runtime/image-tool.mjs 后，prepare-local.mjs 的
// 固定拷贝清单最初漏掉该文件，构建出的安装包在配置图片服务后会因
// ERR_MODULE_NOT_FOUND 无法挂载 generate_image。此测试保证清单覆盖每个导入。
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');

test('prepare-local bundles every local module imported by the packaged pi-runtime entrypoints', async () => {
  const [prepareScript, sdkRuntime] = await Promise.all([
    readFile(join(here, 'prepare-local.mjs'), 'utf8'),
    readFile(join(repo, 'packages/pi-runtime/sdk-runtime.mjs'), 'utf8'),
  ]);
  const imports = [...sdkRuntime.matchAll(/from '\.\/([A-Za-z0-9._-]+\.mjs)'/g)].map(m => m[1]);
  assert.ok(imports.length >= 3, `sdk-runtime 应有多个本地导入，实际解析到 ${imports.length}`);
  for (const name of imports) {
    assert.ok(
      prepareScript.includes(`packages/pi-runtime/${name}`),
      `prepare-local.mjs 拷贝清单缺少 packages/pi-runtime/${name}`,
    );
  }
  assert.ok(prepareScript.includes('packages/pi-runtime/image-tool.mjs'), '图片工具必须随包分发');
});

test('MuMa display branding keeps the existing application and user data identity', async () => {
  const [prepare, main, launcher, pkg, shell] = await Promise.all([
    readFile(join(here, 'prepare-local.mjs'), 'utf8'),
    readFile(join(here, 'main.mjs'), 'utf8'),
    readFile(join(here, 'dsh-launcher.sh'), 'utf8'),
    readFile(join(here, 'package.json'), 'utf8').then(JSON.parse),
    readFile(join(here, 'plugin/package.json'), 'utf8').then(JSON.parse),
  ]);
  assert.equal(pkg.productName, '沐码');
  assert.equal(pkg.version, shell.version, 'app and shell ship the same update version');
  assert.equal(shell.name, 'moos-electron-shell', 'existing shell upgrade identity is retained');
  assert.ok(prepare.includes("join(build, '沐码.app')"));
  assert.ok(prepare.includes("const newName = 'MuMa' + suffix"), 'all helpers follow executable rename');
  assert.ok(prepare.includes("CFBundleExecutable: 'MuMa'"));
  assert.ok(launcher.includes('MacOS/MuMa'), 'host still launches the actual packaged executable');
  assert.ok(!launcher.includes('MacOS/Moos'));
  assert.ok(prepare.includes("CFBundleIdentifier: 'dev.moos.agent.electron'"));
  assert.ok(prepare.includes("['en', '沐码'], ['zh-Hans', '沐码'], ['zh-Hant', '沐碼']"));
  assert.ok(main.includes("app.setName('沐码')"));
  assert.ok(main.includes("title: '沐码'"));
  assert.ok(main.includes("label: '沐码'"));
  assert.ok(prepare.includes("CFBundleName: 'MuMa', CFBundleDisplayName: '沐码'"));
  assert.ok(!main.includes('MuMa · 沐码'));
  assert.ok(main.includes("join(app.getPath('appData'), 'dev.moos.agent.electron')"));
  assert.ok(main.includes("session.fromPartition('persist:moos-workbench')"));
  assert.ok(main.includes("'moos.sqlite'"));
});

test('every local module imported by main.mjs is listed in the packaging manifest', async () => {
  const [main, prepare] = await Promise.all([
    readFile(join(here, 'main.mjs'), 'utf8'),
    readFile(join(here, 'prepare-local.mjs'), 'utf8'),
  ]);
  const manifest = prepare.match(/for \(const file of \[([^\]]+)\]\)/);
  assert.ok(manifest, 'packaging file manifest not found in prepare-local.mjs');
  const listed = manifest[1].match(/'([^']+)'/g).map(s => s.slice(1, -1));
  // pi-models.js is copied separately from plugin/ onto the app root
  const separatelyCopied = ['pi-models.js'];
  for (const name of separatelyCopied) {
    assert.ok(
      prepare.includes(`join(appSource, '${name}')`),
      `${name} must be copied onto the app root in prepare-local.mjs`,
    );
  }
  const localImports = [...main.matchAll(/from '(\.\/[^']+)'/g)];
  assert.ok(localImports.length > 0, 'expected relative imports in main.mjs');
  for (const [, target] of localImports) {
    const file = target.replace('./', '');
    assert.ok(
      listed.includes(file) || separatelyCopied.includes(file),
      `main.mjs imports ${target} but prepare-local.mjs manifest lacks ${file}`,
    );
  }
});

test('desktop helper is compiled into Resources/bin and smoke-checked at build time', async () => {
  const prepare = await readFile(join(here, 'prepare-local.mjs'), 'utf8');
  const source = await readFile(join(here, 'desktop-helper.swift'), 'utf8');
  assert.ok(prepare.includes("'desktop-helper.swift'"), 'prepare-local must compile the Swift helper');
  assert.ok(prepare.includes("'bin'"), 'helper must land in Resources/bin');
  assert.ok(prepare.includes('arm64-apple-macos14'), 'helper target must match the app minimum');
  assert.ok(prepare.includes('"version":"1"'), 'build must smoke-check the helper binary');
  assert.ok(source.includes('system-permission-required'), 'permission gates must stay structured');
});

test('MuMa app and sidebar icons are the approved family assets with a complete ICNS container', async () => {
  const { createHash } = await import('node:crypto');
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  const manifest = JSON.parse(await readFile(join(here, 'assets/brand-assets.json'), 'utf8'));
  assert.equal(manifest.name, '沐码');
  for (const [name, expected] of Object.entries(manifest.sha256)) {
    assert.equal(digest(await readFile(join(here, 'assets', name))), expected, name);
  }
  const icns = await readFile(join(here, 'assets/moos.icns'));
  assert.equal(icns.toString('ascii', 0, 4), 'icns');
  assert.equal(icns.readUInt32BE(4), icns.length);
  const types = [];
  for (let offset = 8; offset < icns.length;) {
    const length = icns.readUInt32BE(offset + 4);
    assert.ok(length > 8 && offset + length <= icns.length);
    types.push(icns.toString('ascii', offset, offset + 4));
    offset += length;
  }
  assert.ok(types.includes('ic10'), '1024 pixel macOS representation exists');
});

test('candidate plugin resolves and executes the packaged native helper from its actual profile location', {
  skip: !process.env.MOOS_ELECTRON_TEST_DSH_CLI && 'Requires a current helper-bearing isolated build', timeout: 30000,
}, async t => {
  const { resolve } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const resources = resolve(dirname(process.env.MOOS_ELECTRON_TEST_DSH_CLI), '../..');
  const { desktopHelperPath } = await import(pathToFileURL(join(resources,
    'profile-template/profiles/web/node_modules/moos-electron-shell/host.js')).href);
  const helperPath = desktopHelperPath(join(resources, 'pi-runtime'), '');
  assert.equal(helperPath, join(resources, 'bin/moos-desktop-helper'));
  const { createDesktopTools } = await import(pathToFileURL(join(resources, 'pi-runtime/packages/pi-runtime/desktop-tools.mjs')).href);
  const tools = createDesktopTools({ helperPath, ownerId: 'packaged-readonly-acceptance' });
  assert.equal(tools.length, 9);
  const permissions = await tools.find(t => t.name === 'desktop_permissions').execute('p', {});
  assert.equal(permissions.details.helperVersion, '1');
  const displays = await tools.find(t => t.name === 'desktop_displays').execute('d', {});
  assert.ok(displays.details.displays.length > 0);
  assert.ok(displays.details.displays.every(d => Number.isFinite(d.x) && Number.isFinite(d.y)));

  // Actual packaged PI SDK -> local model -> custom tool -> real native helper,
  // with synthetic credentials/isolated sessions and only read-only native modes.
  const { createServer } = await import('node:http');
  const { mkdtemp, mkdir, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const root = await mkdtemp(join(tmpdir(), 'moos-packaged-desktop-'));
  await mkdir(join(root, 'project'));
  const requests = [], events = [];
  const calls = ['desktop_permissions', 'desktop_displays'];
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    requests.push(JSON.parse(raw));
    const name = calls[requests.length - 1];
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const delta = name ? { tool_calls: [{ index: 0, id: `call_${requests.length}`, type: 'function',
      function: { name, arguments: '{}' } }] } : { content: 'DESKTOP_NATIVE_READONLY_OK' };
    for (const [data, finish] of [[delta, null], [{}, name ? 'tool_calls' : 'stop']]) {
      res.write('data: ' + JSON.stringify({ id: 'chatcmpl-native', object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: data, finish_reason: finish }] }) + '\n\n');
    }
    res.end('data: [DONE]\n\n');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); server.close(); await rm(root, { recursive: true, force: true }); });
  const { runPiSdk } = await import(pathToFileURL(join(resources, 'pi-runtime/packages/pi-runtime/sdk-runtime.mjs')).href);
  const result = await runPiSdk({ task: { text: 'Query desktop permissions and displays only.', timeoutMs: 600000 },
    project: { path: join(root, 'project') }, conversation: { id: 'packaged-desktop' }, dataDir: join(root, 'sessions'),
    apiKey: 'synthetic-local-only', imageGen: null, desktop: { helperPath }, emit: (name, value) => events.push([name, value]),
    provider: { id: 'native-local-test', name: 'Local acceptance', baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      model: 'synthetic', api: 'openai-completions', contextWindow: 32000, maxTokens: 2048 },
  });
  assert.equal(result.text, 'DESKTOP_NATIVE_READONLY_OK');
  assert.equal(requests.length, 3);
  assert.equal(requests[0].tools.filter(t => t.function.name.startsWith('desktop_')).length, 9);
  assert.deepEqual(events.filter(([name]) => name === 'tool_start').map(([, e]) => e.toolName), calls);
  assert.deepEqual(events.filter(([name]) => name === 'tool_end').map(([, e]) => e.isError), [false, false]);
  assert.deepEqual(events.filter(([name]) => name === 'desktop_action').map(([, e]) => e.phase), ['running', 'done']);
});
