// Local AppKit feasibility only: stock NSH shell and a separate private PI pipe window.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = dirname(fileURLToPath(import.meta.url));
const root = resolve(source, '../..');
const nsh = join(root, 'artifacts/nsh-validation/toolchain/nsh/bin/nsh');
const dir = await mkdtemp(join(root, 'artifacts/nsh-validation/appkit-spike.'));
const local = join(dir, 'source');
const node = process.execPath;
const env = { PATH: '/usr/bin:/bin', TMPDIR: '/private/tmp/', LANG: 'en_US.UTF-8' };
console.log(`Evidence directory: ${dir}`);
function run(executable, argv, opts = {}) {
  return execFileSync(executable, argv, { cwd: dir, env, encoding: 'utf8', timeout: 120000, ...opts });
}
async function record(path) {
  const bytes = await readFile(path);
  return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
async function log(name, executable, argv, opts = {}) {
  const result = spawnSync(executable, argv, { cwd: dir, env, encoding: 'utf8', timeout: 120000, ...opts });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  await writeFile(join(dir, `${name}.log`), output);
  if (result.error || result.status !== 0) throw Error(`${name} failed; see evidence directory`, { cause: result.error });
  return output;
}
assert.equal(process.platform, 'darwin');
assert.equal(process.arch, 'arm64');
assert.equal(process.version, 'v24.15.0');
const version = run(nsh, ['--version']).trim();
assert.equal(version, 'nsh 0.5.0 (f4d68f7)');
await mkdir(local);
const name = 'NSH AppKit Baseline';
const id = 'dev.muma.probe.nsh.appkit.baseline';
await writeFile(join(local, 'nsh.json'), JSON.stringify({ name, id, version: '1.0.0', build: 1,
  capabilities: { host: ['projects.list'], statusBar: true } }));
const baseline = 'desktop-appkit-baseline.tsx', test = 'desktop-appkit-baseline.test.tsx';
const swift = 'DesktopAppKitPipeCheck.swift', pipe = 'DesktopPipe.swift', stdio = 'desktop-host-stdio.mjs';
const inputs = Object.fromEntries(await Promise.all([baseline, test, swift, pipe, stdio, basename(fileURLToPath(import.meta.url))]
  .map(async file => [file, await record(join(source, file))])));
for (const file of [baseline, test]) {
  await copyFile(join(source, file), join(local, file));
  assert.deepEqual(await record(join(local, file)), inputs[file]);
}
const entry = join(local, baseline);
await writeFile(join(local, 'App.tsx'), `import './${baseline}';\n`);
const headless = await log('baseline-test', nsh, ['test', local]);
assert.match(headless, /stock AppKit probe renders a failed call, not a successful PI response/);
assert.match(headless, /1 passed, 0 failed/);
const release = join(dir, 'release');
await log('baseline-build', nsh, ['package', entry, '--target', 'macos', '--arch', 'arm64', '--out', release]);
const app = join(release, `${name}.app`);
const plist = join(app, 'Contents/Info.plist');
const get = key => run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist]).trim();
assert.equal(get('CFBundleIdentifier'), id);
const executable = get('CFBundleExecutable');
assert.equal(basename(executable), executable);
const runner = join(app, 'Contents/MacOS', executable);
assert.equal(run('/usr/bin/lipo', ['-archs', runner]).trim(), 'arm64');
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
const signed = await record(runner);
const stripped = join(dir, 'stripped-copy');
await log('strip-copy', '/usr/bin/xcrun', ['strip', '-S', '-x', '-o', stripped, runner]);
const zip = join(dir, 'NSH-AppKit-Baseline.zip');
run('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, zip]);
// The CLI writes JS diagnostics to stderr. Keep this limited to synthetic markers.
const baselineRun = await log('baseline-exit', runner, [],
  { timeout: 15000, env: { ...env, RUST_LOG: 'info' } });
assert.match(baselineRun, /APPKIT_BASELINE false ERR_FEATURE_UNAVAILABLE_ON_PLATFORM/);
assert.deepEqual(await record(runner), signed);
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
const fixed = join(dir, 'DesktopFixedLaunch.swift');
await writeFile(fixed, `enum DesktopFixedLaunch { static let node = ${JSON.stringify(node)}; static let script = ${JSON.stringify(join(source, stdio))} }\n`);
const probe = join(dir, 'appkit-pipe');
await log('pipe-build', '/usr/bin/xcrun', ['swiftc', '-swift-version', '5', '-Osize', '-parse-as-library', '-framework', 'AppKit',
  join(source, pipe), join(source, swift), fixed, '-o', probe]);
const transport = JSON.parse(await log('pipe-run', probe, [], { timeout: 120000 }));
assert.deepEqual(transport, { passed: true, stage: 'complete', forced: false, hostExit: 0, stderrBytes: 0, nshEmbedded: false,
  checks: ['window', 'projects and session', 'real PI write/read and public text', 'foreign task denied',
    'Stop then terminal and full drain', 'same-session Send after drain', 'active EOF and normal child exit'] });
for (const [file, expected] of Object.entries(inputs)) assert.deepEqual(await record(join(source, file)), expected);
const receipt = { version, node: process.version, arch: process.arch, id, inputs, installed: false, externalModel: false,
  platform: run('/usr/bin/sw_vers', ['-productVersion']).trim(),
  baseline: { app: relative(root, app), runner: signed, stripped: await record(stripped),
    bundleKiB: Number(run('/usr/bin/du', ['-sk', app]).split(/\s/)[0]), zipBytes: (await stat(zip)).size,
    signed: 'ad-hoc deep strict', headlessPassed: 1, available: false, error: 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM', quit: true },
  transport };
await writeFile(join(dir, 'result.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
