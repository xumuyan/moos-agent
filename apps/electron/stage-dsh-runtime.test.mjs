import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { stageDshRuntime } from './stage-dsh-runtime.cjs';
import { createPiAdapter, route } from './plugin/pi-route.js';

test('the carried Host drops optional packages and their inventory entries, but keeps plugin installation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'moos-stage-dsh-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const resources = join(root, 'original');
  const dsh = join(resources, 'app.asar', 'dsh');
  const target = join(root, 'target');
  const keep = ['@deepseek-ai/dsh', '@deepseek-ai/dsh-plugin-manager', '@deepseek-ai/dsh-client-ui-conversation',
    '@deepseek-ai/dsh-llm'];
  const omit = ['@deepseek-ai/dsh-tool-executor-native', '@deepseek-ai/dsh-client-ui-sidebar-terminal',
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
  const registration = 'prepareRoutes(providers, adapter, owned) {\n\t\t\tconst unique = new Set();\n}';
  await write(join(dsh, llm), registration);
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
  assert.match(await readFile(join(built, llm), 'utf8'), /providers\.some\(provider => provider !== "moos-pi"\)/);
  assert.equal((await stat(join(target, 'runtime/bin/node'))).mode & 0o777, 0o755);
  assert.equal(await readFile(join(target, 'runtime/primary-runtime/dependencies/pnpm/bin/pnpm.mjs'), 'utf8'), 'package manager');
  await assert.rejects(stat(join(target, 'runtime/primary-runtime/dependencies/python')), { code: 'ENOENT' });

  await write(join(dsh, llm), '// upstream registration changed');
  assert.throws(() => stageDshRuntime(resources, join(root, 'incompatible')), /Unexpected DSH model registration boundary/);
});

const dshCli = process.env.MOOS_ELECTRON_TEST_DSH_CLI;
test('the packaged DSH registry accepts PI and rejects external adapters on register and replace', {
  skip: !dshCli && 'Set MOOS_ELECTRON_TEST_DSH_CLI to the pinned Moos DSH CLI',
}, async () => {
  const require = createRequire(join(dirname(dshCli), '..', 'dsh', 'package.json'));
  const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')));
  const { LlmRuntime } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')));
  const llm = new LlmRuntime(new Context());
  const other = {
    providerInfo: () => ({ id: 'external', name: 'External plugin' }),
    providerRetryPolicy: () => undefined,
  };
  assert.throws(() => llm.registerAdapter(['external'], other), { code: 'INVALID_ADAPTER' });
  const pi = llm.registerAdapter([route], createPiAdapter({}));
  try {
    assert.throws(() => pi.replace([route, 'external']), { code: 'INVALID_ADAPTER' });
    assert.deepEqual(llm.listProviders().map(provider => provider.id), [route]);
    assert.equal((await llm.resolveModelInfo(route, 'pi-fixture')).id, 'pi-fixture');
  } finally {
    pi();
  }
});
