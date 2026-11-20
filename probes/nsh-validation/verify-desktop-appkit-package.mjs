// Build/relocate the isolated, fixture-only arm64 AppKit bundle; no installation.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hostFiles, packageRuntime, verifyInternalLinks, verifyPackageIdentity } from './desktop-package.mjs';
import { trimDependencyMaps } from './desktop-appkit-size.mjs';

const probe = dirname(fileURLToPath(import.meta.url));
const root = resolve(probe, '../..');
process.chdir(root);
process.umask(0o077);
assert.equal(process.platform, 'darwin');
assert.equal(process.arch, 'arm64');
assert.equal(process.version, 'v24.15.0');
const trimMaps = process.argv[3] === '--trim-maps';
assert.equal(process.argv.length, trimMaps ? 4 : 3, 'Pass the ignored appkit-package build directory and optional --trim-maps');
const dir = await realpath(resolve(process.argv[2]));
const base = await realpath(join(root, 'artifacts/nsh-validation'));
assert.match(relative(base, dir), /^appkit-package\.[A-Za-z0-9]+$/);
assert.equal((await lstat(dir)).mode & 0o7777, 0o700);
assert.equal((await readFile(join(dir, 'native.status'), 'utf8')).trim(), '0');
const env = { PATH: '/usr/bin:/bin', TMPDIR: '/private/tmp/', LANG: 'en_US.UTF-8' };
const run = (exe, args, opts = {}) => execFileSync(exe, args, { env, encoding: 'utf8', timeout: 120000, ...opts });
const record = async path => {
  const bytes = await readFile(path);
  return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
};
const id = 'dev.muma.probe.nsh.appkit.package.check';
const nsh = join(base, 'toolchain/nsh/bin/nsh');
assert.equal(run(nsh, ['--version']).trim(), 'nsh 0.5.0 (f4d68f7)');
const ui = join(dir, 'package-ui');
const app = join(dir, '沐码.app'), contents = join(app, 'Contents'), resources = join(contents, 'Resources');
const macos = join(contents, 'MacOS'), executable = 'AppKitPI', dylib = 'libN01AppKitPipe.dylib';
await mkdir(ui);
await copyFile(join(probe, 'appkit-hostcheck/PackageCheck.tsx'), join(ui, 'App.tsx'));
await writeFile(join(ui, 'nsh.json'), JSON.stringify({ name: '沐码', id, version: '1.0.0', build: 1,
  capabilities: { host: ['projects.list', 'sessions.list', 'sessions.create', 'tasks.submit', 'tasks.cancel', 'tasks.events', 'sessions.history', 'n01.complete'], statusBar: true } }));
await writeFile(join(dir, 'tsx-build.log'), run(nsh, ['build', '.', '--release', '-o', 'build'], { cwd: ui }));
await mkdir(join(resources, 'ui'), { recursive: true });
await mkdir(macos);
for (const file of ['bundle.js', 'app.json', 'capabilities.json']) await copyFile(join(ui, 'build', file), join(resources, 'ui', file));
for (const file of [executable, dylib]) await copyFile(join(dir, file), join(macos, file));
const plist = join(contents, 'Info.plist');
run('/usr/bin/plutil', ['-create', 'xml1', plist]);
for (const [name, value] of Object.entries({ CFBundleExecutable: executable, CFBundleIdentifier: id,
  CFBundleName: 'MuMa', CFBundleDisplayName: '沐码', CFBundleIconFile: 'moos.icns', CFBundlePackageType: 'APPL',
  CFBundleShortVersionString: '1.0.0', CFBundleVersion: '1' })) run('/usr/bin/plutil', ['-insert', name, '-string', value, plist]);
const inputs = Object.fromEntries(await Promise.all(hostFiles.map(async file => [file, await record(file)])));
const runtime = await packageRuntime({ app, node: process.execPath, dir, check: true, run, record, inputs });
// Retain provider routing code for a staged dual-protocol test; the signed AppKit
// entry never loads a real provider config and stays in synthetic profile mode.
const routes = 'desktop-live-models.mjs';
const modules = 'Contents/Resources/host/probes/nsh-validation';
await copyFile(join(probe, routes), join(app, modules, routes));
const deps = 'Contents/Resources/host/node_modules';
if (trimMaps) {
  const removed = await trimDependencyMaps(join(app, deps));
  assert.ok(removed.length > 0);
  await writeFile(join(dir, 'trimmed-maps.json'), JSON.stringify(removed, null, 2) + '\n');
}
run('/usr/bin/codesign', ['--force', '--sign', '-', join(macos, dylib)]);
run('/usr/bin/codesign', ['--force', '--sign', '-', app]);
function verify(path) {
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', path]);
  return verifyPackageIdentity(path, id);
}
const identity = verify(app);
await verifyInternalLinks(app);
const destination = await mkdtemp('/private/tmp/n01-appkit-package-');
await writeFile(join(dir, 'relocation.txt'), `${destination}\n`);
const relocated = join(destination, '沐码.app');
await rename(app, relocated);
for (const part of ['profile', 'storage']) await mkdir(join(destination, part), { mode: 0o700 });
verify(relocated);
const binary = join(relocated, 'Contents/MacOS', executable);
const node = join(relocated, 'Contents/MacOS/moos-node');
assert.equal(run(node, ['--version'], { cwd: destination }).trim(), 'v24.15.0');
assert.equal(run('/usr/bin/lipo', ['-archs', binary]).trim(), 'arm64');

async function log(name, exe, args) {
  const result = spawnSync(exe, args, { env, cwd: destination, encoding: 'utf8', timeout: 90000, killSignal: 'SIGKILL' });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  await writeFile(join(dir, `${name}.log`), output);
  assert.equal(result.status, 0, `${name} failed (status=${result.status}, signal=${result.signal}); see local log`);
  return output;
}
const scopePattern = (name) => new RegExp(`N01_APPKIT_PACKAGE ${name} ([a-f0-9-]{36}) ([a-f0-9-]{36})`);
async function launch(name) {
  const output = await log(name, binary, []);
  assert.match(output, /N01_HOST_EXIT 0 forced=false stderrBytes=0/);
  assert.doesNotMatch(output, /N01_APPKIT_PACKAGE_FAILED/);
  const scope = output.match(scopePattern(name))?.slice(1);
  assert.equal(scope?.length, 2, `Missing ${name} result`);
  await assert.rejects(lstat(join(destination, 'profile/.n01-active')), { code: 'ENOENT' });
  return scope;
}
const scope = await launch('first');
assert.deepEqual(await launch('reopened'), scope);
assert.equal(await readFile(join(destination, 'profile/workspace-0/result.txt'), 'utf8'), 'APPKIT_PACKAGE\n');

// Run only the existing dual-protocol PI test using the relocated app's Node
// and imported Host modules, not the checkout's dependency resolution.
const testPath = join(destination, 'dual-protocol.test.mjs');
const testText = (await readFile(join(probe, 'desktop-live-models.test.mjs'), 'utf8'))
  .replace(/from '\.\/(desktop-(?:live-models|host|host-stdio)\.mjs)'/g,
    (_, file) => `from '${pathToFileURL(join(relocated, modules, file)).href}'`);
await writeFile(testPath, testText);
const dual = await log('dual-protocol', node, ['--test', '--test-reporter=tap', '--test-name-pattern=private pipe . real PI SDK: both protocols', testPath]);
assert.match(dual, /# pass 1\b/);
assert.match(dual, /# fail 0\b/);
verify(relocated);
const zip = join(dir, 'MuMa-AppKit-Check.zip');
run('/usr/bin/ditto', ['-c', '-k', '--keepParent', relocated, zip]);
const kib = path => Number(run('/usr/bin/du', ['-sk', path]).trim().split(/\s+/)[0]);
const receipt = { platform: run('/usr/bin/sw_vers', ['-productVersion']).trim(), arch: 'arm64', node: process.version,
  identity, signed: 'ad-hoc deep strict', relocated: true, installed: false, fixtureOnly: true, downloadsAtFirstRun: 0,
  bundleKiB: kib(relocated), zipBytes: (await stat(zip)).size, runner: await record(binary),
  nodeKiB: kib(node), dependencyKiB: kib(join(relocated, deps)), trimMaps,
  runtime, scope, checks: ['empty profile', 'reopen prior text before submission', 'scope preserved', 'PI continuation uses prior context',
    'Stop then terminal and fully drained', 'same-session write/read', 'both protocols on packaged Node/PI using loopback', 'clean EOF and lease release twice'] };
await writeFile(join(dir, 'result.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
