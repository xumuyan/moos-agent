import test from 'node:test';
import assert from 'node:assert/strict';
import { link, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pruneArm64DependencyPayload } from './desktop-appkit-prune.mjs';

const arm64 = process.platform === 'darwin' && process.arch === 'arm64';
const native = '@earendil-works/pi-tui/native';
const otherTargets = ['darwin/prebuilds/darwin-x64/darwin-platform.node',
  'linux/prebuilds/linux-arm64/linux-platform-x11.node', 'linux/prebuilds/linux-x64/linux-platform-x11.node',
  'win32/prebuilds/win32-arm64/win32-platform.node', 'win32/prebuilds/win32-x64/win32-platform.node'];
const active = `${native}/darwin/prebuilds/darwin-arm64/darwin-platform.node`;
const redundant = ['openai/src/client.ts', '@anthropic-ai/sdk/src/client.ts', ...otherTargets.map(path => `${native}/${path}`)];
const retained = ['openai/src/uncompiled.ts', 'openai/src/client.d.ts', 'openai/src/auth.cts', 'openai/src/LICENSE',
  'openai/src/_vendor/lib.ts', 'openai/src/with-attribution.ts', 'openai/src/code.json', 'openai/client.js', 'openai/client.mjs',
  '@anthropic-ai/sdk/client.js', '@anthropic-ai/sdk/client.mjs', '@earendil-works/pi-coding-agent/docs/sdk.md', active];
const sdk = { name: 'openai', version: '7.19.0', main: './client.js',
  imports: { '#auth': { types: './src/auth.cts', default: './client.js' } } };
async function fixture(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'n01-prune-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  async function put(path, text = path) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), text);
  }
  for (const path of [...redundant, ...retained]) await put(path);
  await put('openai/src/with-attribution.ts', '// Copyright Example');
  for (const stem of ['_vendor/lib', 'with-attribution']) {
    await put(`openai/${stem}.js`);
    await put(`openai/${stem}.mjs`);
  }
  for (const pkg of [sdk, { name: '@anthropic-ai/sdk', version: '0.129.0' }, { name: '@earendil-works/pi-tui', version: '1.5.0' }]) {
    await put(`${pkg.name}/package.json`, JSON.stringify(pkg));
  }
  return { dir, put };
}

test('AppKit pruning drops only matched duplicate sources and five other-platform binaries', { skip: !arm64 }, async t => {
  const { dir } = await fixture(t);
  const removed = await pruneArm64DependencyPayload(dir);
  assert.deepEqual(removed.map(item => item.path), redundant.sort());
  for (const {path, reason, bytes } of removed) {
    assert.equal(bytes, Buffer.byteLength(path));
    assert.equal(reason, path.startsWith(native) ? 'non-darwin-arm64-addon' : 'duplicate-sdk-source');
    await assert.rejects(lstat(join(dir, path)), { code: 'ENOENT' });
  }
  for (const path of retained) assert.equal(await readFile(join(dir, path), 'utf8'),
    path.endsWith('with-attribution.ts') ? '// Copyright Example' : path);
});

test('AppKit pruning fails closed before deletion on manifest or target changes', { skip: !arm64 }, async t => {
  const { dir, put } = await fixture(t);
  for (const change of [{ version: '8.0.0' }, { exports: { '.': { import: './src/client.ts' } } }]) {
    await put('openai/package.json', JSON.stringify({ ...sdk, ...change }));
    await assert.rejects(pruneArm64DependencyPayload(dir));
    for (const path of redundant) assert.ok((await lstat(join(dir, path))).isFile());
  }
});

test('AppKit pruning rejects hardlinked or redirected targets without partial deletes', { skip: !arm64 }, async t => {
  const { dir, put } = await fixture(t);
  const path = redundant.find(name => name.includes('win32-x64'));
  const file = join(dir, path), other = join(dir, 'other');
  await rm(file);
  await put('other', 'keep');
  await link(other, file);
  await assert.rejects(pruneArm64DependencyPayload(dir));
  await rm(file);
  await symlink(other, file);
  await assert.rejects(pruneArm64DependencyPayload(dir));
  for (const keep of redundant.filter(name => name !== path)) assert.ok((await lstat(join(dir, keep))).isFile());
  assert.equal(await readFile(other, 'utf8'), 'keep');
});

test('AppKit pruning rejects the wrong host architecture', { skip: arm64 }, async () => {
  await assert.rejects(pruneArm64DependencyPayload('unused'), { code: 'ERR_ASSERTION' });
});
