import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, chmod, link, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { trimDependencyMaps } from './desktop-appkit-size.mjs';

const map = JSON.stringify({ version: 3, sources: ['hello.ts'], mappings: 'AA' });
test('map-only size trial retains executable modules, other assets, licenses and linked files', async t => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'n01-dep-maps-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await chmod(dir, 0o700);
  const deps = join(dir, 'node_modules'), lib = join(deps, 'sdk');
  await mkdir(lib, { recursive: true });
  for (const [name, contents] of Object.entries({ 'index.mjs.map': map, 'index.d.ts.map': map, 'index.mjs': 'export default 1',
    'index.d.ts': 'declare const x: number', 'index.js.map': 'not json', 'table.map': map, 'data.ts.map': '{}', LICENSE: 'license' })) {
    await writeFile(join(lib, name), contents);
  }
  const outside = join(dir, 'outside.mjs.map');
  await writeFile(outside, map);
  await link(outside, join(lib, 'hard.js.map'));
  await symlink(outside, join(lib, 'link.js.map'));
  const alias = join(dir, 'alias');
  await symlink(deps, alias);
  await assert.rejects(trimDependencyMaps(alias));
  const removed = await trimDependencyMaps(deps);
  assert.deepEqual(removed.map(file => file.path).sort(), ['sdk/index.d.ts.map', 'sdk/index.mjs.map']);
  assert.ok(removed.every(file => file.bytes === Buffer.byteLength(map) && file.allocatedBytes >= 0));
  assert.deepEqual((await readdir(lib)).sort(), ['LICENSE', 'data.ts.map', 'hard.js.map', 'index.d.ts', 'index.js.map',
    'index.mjs', 'link.js.map', 'table.map'].sort());
  assert.deepEqual(await trimDependencyMaps(deps), []);
});
