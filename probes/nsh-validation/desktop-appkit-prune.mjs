// Narrow allowlist for a fresh, offline npm install staged for AppKit arm64.
// Never guess that a provider, WASM binary, docs tree or asset is unused.
import assert from 'node:assert/strict';
import { lstat, readFile, readdir, realpath, unlink } from 'node:fs/promises';
import { join, relative } from 'node:path';

const sdkVersions = { openai: '7.19.0', '@anthropic-ai/sdk': '0.129.0' };
const tui = '@earendil-works/pi-tui';
const native = [
  'darwin/prebuilds/darwin-x64/darwin-platform.node',
  'linux/prebuilds/linux-arm64/linux-platform-x11.node',
  'linux/prebuilds/linux-x64/linux-platform-x11.node',
  'win32/prebuilds/win32-arm64/win32-platform.node',
  'win32/prebuilds/win32-x64/win32-platform.node',
].map(path => `${tui}/native/${path}`);
const arm = `${tui}/native/darwin/prebuilds/darwin-arm64/darwin-platform.node`;

export async function pruneArm64DependencyPayload(root) {
  assert.equal(process.platform, 'darwin');
  assert.equal(process.arch, 'arm64');
  assert.equal(await realpath(root), root, 'Expected a canonical dependency tree');
  assert.ok((await lstat(root)).isDirectory());
  async function regular(path) {
    assert.equal(await realpath(path), path, 'Refusing a linked dependency path');
    const info = await lstat(path);
    assert.ok(info.isFile() && info.nlink === 1, 'Expected an unlinked regular file');
    return info;
  }
  async function manifest(name, version) {
    const path = join(root, name, 'package.json');
    await regular(path);
    const value = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(value.name, name);
    assert.equal(value.version, version, `Review pruning rules before upgrading ${name}`);
    return value;
  }
  const candidates = [];
  async function add(path, reason) {
    const info = await regular(path);
    candidates.push({ path: relative(root, path), reason, bytes: info.size, allocatedBytes: info.blocks * 512 });
  }
  for (const [name, version] of Object.entries(sdkVersions)) {
    const pkg = await manifest(name, version);
    // Source-only entries (including OpenAI's private .cts type target) stay.
    // No part of src is an import/require/default export in these versions.
    function checkTargets(value, key) {
      if (key === 'types') return;
      if (typeof value === 'string') assert.doesNotMatch(value, /^\.\/src(?:\/|$)/);
      else if (value && typeof value === 'object') {
        for (const [childKey, child] of Object.entries(value)) checkTargets(child, childKey);
      }
    }
    for (const field of ['exports', 'imports', 'main', 'module', 'browser', 'bin']) checkTargets(pkg[field]);
    const base = join(root, name);
    async function walk(dir) {
      assert.equal(await realpath(dir), dir);
      for (const item of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, item.name);
        if (item.isDirectory() && item.name !== '_vendor') await walk(path);
        if (!item.isFile() || !/\.ts$/.test(item.name) || /\.d\.ts$/.test(item.name)) continue;
        const stem = join(base, relative(join(base, 'src'), path).slice(0, -3));
        const twins = await Promise.all(['.js', '.mjs'].map(ext => lstat(stem + ext).catch(error => {
          if (error.code === 'ENOENT') return null;
          throw error;
        })));
        if (!twins.every(entry => entry?.isFile())) continue;
        await regular(stem + '.js');
        await regular(stem + '.mjs');
        // Preserve any source carrying its own licensing or attribution notice.
        const text = await readFile(path, 'utf8');
        if (/copyright|@license|\bSPDX\b|©/i.test(text)) continue;
        await add(path, 'duplicate-sdk-source');
      }
    }
    await walk(join(base, 'src'));
  }
  assert.ok(candidates.length > 0, 'No duplicate SDK sources found');
  await manifest(tui, '1.5.0');
  await regular(join(root, arm));
  for (const path of native) await add(join(root, path), 'non-darwin-arm64-addon');
  candidates.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  // Preflight the entire allowlist before deleting a file. Do not remove dirs.
  for (const { path } of candidates) await unlink(join(root, path));
  return candidates;
}
