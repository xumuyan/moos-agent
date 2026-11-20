import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { brandRoot, hostFiles, packageCheckId, packageId, verifyInternalLinks } from './desktop-package.mjs';

const repo = new URL('../../', import.meta.url);

test('candidate uses the formal brand bytes but never the formal app identity', async () => {
  const brand = JSON.parse(await readFile(new URL(`${brandRoot}/brand-assets.json`, repo), 'utf8'));
  const icon = await readFile(new URL(`${brandRoot}/moos.icns`, repo));
  assert.equal(brand.name, '沐码');
  assert.equal(icon.subarray(0, 4).toString('ascii'), 'icns');
  assert.equal(createHash('sha256').update(icon).digest('hex'), brand.sha256['moos.icns']);
  assert.equal(packageId, 'dev.muma.probe.nsh.package');
  assert.equal(packageCheckId, 'dev.muma.probe.nsh.package.check');
  assert.equal(new Set(hostFiles).size, hostFiles.length);
  assert.ok(hostFiles.includes('probes/nsh-validation/desktop-package-stdio.mjs'));
  assert.ok(hostFiles.includes('packages/pi-runtime/sdk-runtime.mjs'));
  assert.ok(hostFiles.includes('package-lock.json'));
  for (const file of hostFiles) {
    assert.doesNotMatch(file, /private|credential|profile\.json|providers\.json|live-stdio|node_modules|\.test\./);
    assert.ok((await readFile(new URL(file, repo))).length > 0);
  }
});

test('bundled runtime accepts internal executable links but rejects escapes and broken links', async t => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'n01-package-links-')));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const bundle = join(parent, '沐码.app');
  await mkdir(join(bundle, 'nested'), { recursive: true });
  await writeFile(join(bundle, 'node'), 'synthetic');
  await writeFile(join(parent, 'outside'), 'synthetic');
  await symlink('../node', join(bundle, 'nested', 'internal'));
  await verifyInternalLinks(bundle);
  for (const target of ['../outside', join(bundle, 'node'), './missing']) {
    const link = join(bundle, 'bad');
    await symlink(target, link);
    await assert.rejects(verifyInternalLinks(bundle));
    await rm(link);
  }
});
