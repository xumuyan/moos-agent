// Build-time helpers for the offline, fixture-only Catalyst package.
import { cp, mkdir, readFile, readdir, readlink, realpath, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import assert from 'node:assert/strict';

export const packageId = 'dev.muma.probe.nsh.package';
export const packageCheckId = `${packageId}.check`;
export const brandRoot = 'apps/electron/assets';
export const hostFiles = [
  ...['desktop-package-stdio.mjs', 'desktop-history.mjs', 'desktop-host.mjs', 'desktop-host-stdio.mjs',
    'desktop-model-services.mjs', 'desktop-images.mjs', 'desktop-model-fixture.mjs', 'desktop-statistics.mjs', 'desktop-profile.mjs', 'desktop-team-goal.mjs'].map(file => `probes/nsh-validation/${file}`),
  ...['store', 'scheduler', 'errors', 'task-policy', 'usage', 'timeline-view'].map(file => `services/agent/${file}.mjs`),
  ...['sdk-runtime', 'image-tool', 'tool-policy', 'toolchain', 'image-policy', 'repair-routing', 'session-fork', 'desktop-queue',
    'desktop-tools', 'desktop-transaction', 'desktop-focus-settle', 'team-runtime'].map(file => `packages/pi-runtime/${file}.mjs`),
  'apps/electron/plugin/pi-workspace-changes.js', 'apps/electron/package.json',
  'packages/pi-adapter/index.mjs', 'package.json', 'package-lock.json',
];

export async function verifyInternalLinks(root) {
  const inside = path => { const rel = relative(root, path); return rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel); };
  async function walk(dir) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, item.name);
      if (item.isSymbolicLink()) {
        const target = await readlink(path);
        assert.ok(!isAbsolute(target) && inside(resolve(dirname(path), target)) && inside(await realpath(path)), 'Runtime symlink escapes package');
      } else if (item.isDirectory()) await walk(path);
      else assert.ok(item.isFile(), 'Unexpected runtime file type');
    }
  }
  await walk(root);
}

export async function packageRuntime({ app, node, dir, check, run, record, inputs }) {
  assert.equal(process.version, 'v24.15.0');
  const resources = join(app, 'Contents/Resources');
  const contents = join(app, 'Contents');
  const runtime = join(resources, 'host');
  for (const file of hostFiles) {
    const dst = join(runtime, file);
    await mkdir(dirname(dst), { recursive: true });
    await cp(file, dst);
    assert.deepEqual(await record(dst), inputs[file]);
  }
  // Use only cached lockfile packages; do not ingest the checkout's node_modules,
  // user npm config, install scripts, or any candidate/formal provider files.
  const global = join(dir, 'empty-npmrc');
  await writeFile(global, '');
  const npm = join(dirname(node), 'npm');
  try {
    const output = run(npm, ['ci', '--offline', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund',
      '--userconfig=/dev/null', `--globalconfig=${global}`], { timeout: 120000, cwd: runtime,
      env: { HOME: process.env.HOME, PATH: `${dirname(node)}:/usr/bin:/bin`, TMPDIR: '/private/tmp' } });
    await writeFile(join(dir, 'offline-dependencies.log'), output);
  } catch (error) {
    await writeFile(join(dir, 'offline-dependencies.log'), `${error.stdout ?? ''}\n${error.stderr ?? ''}`);
    throw Error('Offline package dependencies unavailable; see offline-dependencies.log');
  }
  await verifyInternalLinks(runtime);
  const localNode = join(contents, 'MacOS', 'moos-node');
  await cp(node, localNode);
  const license = join(dirname(dirname(node)), 'LICENSE');
  await cp(license, join(resources, 'NODE-LICENSE.txt'));
  const libraries = run('/usr/bin/otool', ['-L', localNode]).trim().split('\n').slice(1).map(line => line.trim().split(' (compatibility')[0]);
  assert.ok(libraries.length && libraries.every(lib => /^\/(System\/Library|usr\/lib)\//.test(lib)), 'Bundled Node requires non-system libraries');
  const brand = JSON.parse(await readFile(join(brandRoot, 'brand-assets.json'), 'utf8'));
  const icon = join(resources, 'moos.icns');
  await cp(join(brandRoot, 'moos.icns'), icon);
  // Xcode generates CFBundleName from the target even if a static plist supplies it.
  run('/usr/bin/plutil', ['-replace', 'CFBundleName', '-string', 'MuMa', join(contents, 'Info.plist')]);
  assert.equal((await record(icon)).sha256, brand.sha256['moos.icns']);
  assert.equal(brand.name, '沐码');
  for (const [locale, text] of [['en', '沐码'], ['zh-Hans', '沐码'], ['zh-Hant', '沐碼']]) {
    const localized = join(resources, `${locale}.lproj`);
    await mkdir(localized, { recursive: true });
    await writeFile(join(localized, 'InfoPlist.strings'), `"CFBundleDisplayName" = "${text}";\n`);
  }
  // The same entry is used by both modes; its immutable build setting selects
  // a throwaway relocation-test profile or the fixed isolated per-user profile.
  await writeFile(join(runtime, 'package-mode.json'), JSON.stringify({ check }));
  run('/usr/bin/codesign', ['--force', '--sign', '-', localNode]);
  return { node: await record(localNode), nodeInput: await record(node), nodeLicense: await record(license), libraries,
    icon: await record(icon), offlineDependencies: true };
}

export function verifyPackageIdentity(app, expectedId) {
  const info = join(app, 'Contents/Info.plist');
  const extract = key => execFileSync('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', info], { encoding: 'utf8' }).trim();
  const identity = { displayName: extract('CFBundleDisplayName'), bundleName: extract('CFBundleName'),
    artifactName: extract('CFBundleIconFile'), bundleIdentifier: extract('CFBundleIdentifier') };
  assert.deepEqual(identity, { displayName: '沐码', bundleName: 'MuMa', artifactName: 'moos.icns', bundleIdentifier: expectedId });
  return identity;
}
