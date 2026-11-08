import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { updateShellPlugin } from './shell-update.mjs';

async function fixture(t, installedVersion = '0.1.26', bundledVersion = '0.1.27') {
  const root = await mkdtemp(join(tmpdir(), 'moos-shell-update-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'data/dsh');
  const resources = join(root, 'resources');
  const manifest = 'profiles/web/node_modules/moos-electron-shell/package.json';
  const installed = join(home, manifest);
  const bundled = join(resources, 'profile-template', manifest);
  for (const [path, version] of [[installed, installedVersion], [bundled, bundledVersion]]) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ name: 'moos-electron-shell', version }));
  }
  const archive = join(resources, 'profile-template/profiles/web/local-bundles', `moos-electron-shell-${bundledVersion}.tgz`);
  await mkdir(dirname(archive), { recursive: true });
  await writeFile(archive, 'synthetic package, not executable');
  const cli = join(root, 'fixture-cli.cjs');
  await writeFile(cli, `#!${process.execPath}\n` + `
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
if (process.env.DSH_HOME !== ${JSON.stringify(home)} || process.env.DSH_TELEMETRY_DISABLED !== '1') process.exit(9);
const want = ['plugin', '--profile', 'web', 'add', ${JSON.stringify(archive)}, '--offline', '--save-exact'];
if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(want)) process.exit(8);
writeFileSync(${JSON.stringify(installed)}, JSON.stringify({ name: 'moos-electron-shell', version: ${JSON.stringify(bundledVersion)} }));
const file = join(process.env.DSH_HOME, 'profiles/web/package.json');
const manifest = JSON.parse(readFileSync(file, 'utf8'));
manifest.dependencies['moos-electron-shell'] = 'file:' + process.argv[7];
writeFileSync(file, JSON.stringify(manifest));
`, { mode: 0o700 });
  const profile = join(home, 'profiles/web/package.json');
  const settings = { dependencies: { 'moos-electron-shell': 'old-package', 'user-plugin': '1.2.3' }, userPreference: 'keep' };
  await writeFile(profile, JSON.stringify(settings));
  return { root, home, resources, installed, bundled, archive, cli, profile, settings };
}

test('same version never invokes the installer or rewrites user metadata', async t => {
  const f = await fixture(t, '0.1.26', '0.1.26');
  const bytes = await readFile(f.profile);
  await updateShellPlugin(f.resources, f.home, '/missing-installer');
  assert.deepEqual(await readFile(f.profile), bytes);
});

test('an isolated package upgrade and restart keep chat and configuration bytes while updating only shell metadata', async t => {
  const f = await fixture(t);
  const sentinels = [
    'data/dsh/sessions/turns.jsonl', 'data/dsh/skins/custom/skin.json',
    'data/dsh/profiles/web/cordis.patch.yml', 'data/providers.json',
    'data/private/credentials.json', 'data/pi/sessions/history.jsonl',
    'data/workspace/project/source.txt',
  ];
  for (const name of sentinels) {
    await mkdir(dirname(join(f.root, name)), { recursive: true });
    await writeFile(join(f.root, name), '合成验收数据：原字节\n');
  }
  await updateShellPlugin(f.resources, f.home, f.cli);
  assert.equal(JSON.parse(await readFile(f.installed, 'utf8')).version, '0.1.27');
  const metadata = JSON.parse(await readFile(f.profile, 'utf8'));
  assert.equal(metadata.dependencies['user-plugin'], '1.2.3');
  assert.equal(metadata.userPreference, 'keep');
  await updateShellPlugin(f.resources, f.home, '/must-not-run-on-restart');
  for (const name of sentinels) assert.equal(await readFile(join(f.root, name), 'utf8'), '合成验收数据：原字节\n', name);
});

test('missing or corrupt installed metadata cannot silently trigger reinstallation', async t => {
  for (const kind of ['missing', 'invalid-json', 'wrong-package', 'invalid-version']) {
    await t.test(kind, async t => {
      const f = await fixture(t);
      const before = await readFile(f.profile);
      if (kind === 'missing') await rm(f.installed);
      else await writeFile(f.installed, kind === 'invalid-json' ? '{' : JSON.stringify({
        name: kind === 'wrong-package' ? 'other-plugin' : 'moos-electron-shell',
        version: kind === 'invalid-version' ? '../escape' : '0.1.26',
      }));
      await assert.rejects(updateShellPlugin(f.resources, f.home, '/must-not-run'), { code: 'MOOS_PROFILE_RECOVERY_REQUIRED' });
      assert.deepEqual(await readFile(f.profile), before);
    });
  }
});

test('downgrades, invalid bundled metadata and missing archives are rejected before user files change', async t => {
  for (const kind of ['downgrade', 'missing-archive', 'invalid-template']) {
    await t.test(kind, async t => {
      const f = await fixture(t, kind === 'downgrade' ? '0.2.0' : '0.1.26');
      const before = await readFile(f.profile);
      if (kind === 'missing-archive') await rm(f.archive);
      if (kind === 'invalid-template') await writeFile(f.bundled, JSON.stringify({ name: 'moos-electron-shell', version: '../../bad' }));
      await assert.rejects(updateShellPlugin(f.resources, f.home, '/must-not-run'));
      assert.deepEqual(await readFile(f.profile), before);
    });
  }
});

test('installer failure stops startup without exposing raw installer output', async t => {
  const f = await fixture(t);
  const before = await readFile(f.profile);
  await writeFile(f.cli, `#!${process.execPath}\nconsole.error('synthetic-private-output'); process.exit(7);`, { mode: 0o700 });
  await assert.rejects(updateShellPlugin(f.resources, f.home, f.cli), error => {
    assert.equal(error.code, 'MOOS_SHELL_UPDATE_FAILED');
    assert.doesNotMatch(String(error), /synthetic-private-output/);
    return true;
  });
  assert.deepEqual(await readFile(f.profile), before);
});

test('installer success without the expected shell version is rejected', async t => {
  const f = await fixture(t);
  await writeFile(f.cli, `#!${process.execPath}\nprocess.exit(0);`, { mode: 0o700 });
  await assert.rejects(updateShellPlugin(f.resources, f.home, f.cli), { code: 'MOOS_SHELL_UPDATE_FAILED' });
  assert.equal(JSON.parse(await readFile(f.installed, 'utf8')).version, '0.1.26');
});

test('startup loads the guarded updater before the Host and bundles its module', async () => {
  const main = await readFile(new URL('./main.mjs', import.meta.url), 'utf8');
  const build = await readFile(new URL('./prepare-local.mjs', import.meta.url), 'utf8');
  assert.match(main, /import \{ updateShellPlugin, shellUpdateMessage \} from '\.\/shell-update\.mjs'/);
  assert.ok(main.indexOf('await updateShellPlugin(resources, home, cli)') < main.indexOf('host = startHost('));
  assert.match(main, /MOOS_SHELL_UPDATE_FAILED/);
  assert.match(build, /for \(const file of \[[^\]]*'shell-update\.mjs'/);
});
