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
