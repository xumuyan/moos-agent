// Optional, narrow trial: remove recognized debug-only source maps from a fresh
// staged production dependency tree. Never drop a package or executable module.
import { lstat, readFile, readdir, realpath, unlink } from 'node:fs/promises';
import { join, relative } from 'node:path';
import assert from 'node:assert/strict';

export async function trimDependencyMaps(root) {
  assert.equal(await realpath(root), root);
  assert.ok((await lstat(root)).isDirectory());
  const removed = [];
  async function walk(dir) {
    for (const item of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, item.name);
      if (item.isDirectory()) await walk(path);
      else if (item.isFile() && /\.(?:[cm]?js|[cm]?ts)\.map$/.test(item.name)) {
        const info = await lstat(path);
        if (info.nlink !== 1 || info.size > 16 * 1024 * 1024 || !info.isFile()) continue;
        let map;
        try { map = JSON.parse(await readFile(path, 'utf8')); }
        catch (error) { if (!(error instanceof SyntaxError)) throw error; continue; }
        if (map?.version !== 3 || !Array.isArray(map.sources) || typeof map.mappings !== 'string') continue;
        await unlink(path);
        removed.push({ path: relative(root, path), bytes: info.size, allocatedBytes: info.blocks * 512 });
      }
    }
  }
  await walk(root);
  return removed;
}
