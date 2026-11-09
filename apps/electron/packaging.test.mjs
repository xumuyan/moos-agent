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
