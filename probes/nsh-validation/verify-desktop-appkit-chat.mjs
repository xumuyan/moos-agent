// Local fixture-only AppKit chat. Explicit --check runs the scripted window;
// --interactive only creates a locally signed app, never launches it.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { copyFile, cp, lstat, mkdir, mkdtemp, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostFiles, packageRuntime, verifyInternalLinks, verifyPackageIdentity } from './desktop-package.mjs';

const probe = dirname(fileURLToPath(import.meta.url));
process.chdir(resolve(probe, '../..'));
process.umask(0o077);
assert.equal(process.platform, 'darwin');
assert.equal(process.arch, 'arm64');
assert.equal(process.version, 'v24.15.0');
const [mode, buildPath, ...extra] = process.argv.slice(2);
assert.ok(buildPath && !extra.length && ['--check', '--interactive'].includes(mode), 'Pass --check or --interactive and an ignored appkit-chat native build directory');
const scripted = mode === '--check';
const base = await realpath('artifacts/nsh-validation');
const build = await realpath(resolve(buildPath));
assert.match(relative(base, build), /^appkit-chat\.[A-Za-z0-9]+$/);
assert.equal((await lstat(build)).mode & 0o7777, 0o700);
assert.equal((await readFile(join(build, 'native.status'), 'utf8')).trim(), '0');
const dir = await mkdtemp(join(base, `appkit-chat-${scripted ? 'check' : 'interactive'}.`));
console.log(`Evidence directory: ${dir}`);
const env = { PATH: '/usr/bin:/bin', TMPDIR: '/private/tmp/', LANG: 'en_US.UTF-8' };
const run = (exe, args, opts = {}) => execFileSync(exe, args, { env, encoding: 'utf8', timeout: 120000, ...opts });
const record = async path => createHash('sha256').update(await readFile(path)).digest('hex');
const id = 'dev.muma.probe.nsh.appkit.chat';
const nsh = join(base, 'toolchain/nsh/bin/nsh');
const version = run(nsh, ['--version']).trim();
assert.equal(version, 'nsh 0.5.0 (f4d68f7)');
const methods = ['projects.list', 'sessions.list', 'sessions.create', 'sessions.history', 'tasks.submit', 'tasks.cancel', 'tasks.events'];
// The two controller/transport owner inputs are used read-only in local copies.
const view = ['DesktopView.tsx', 'DesktopSettings.tsx', 'DesktopComposerStatistics.tsx', 'desktop-composer-statistics.ts',
  'DesktopTurnQueue.tsx', 'desktop-turn-queue.ts', 'desktop-session-preview.ts', 'DesktopModelPicker.tsx', 'desktop-model-picker.ts',
  'DesktopIcon.tsx', 'desktop-icon-paths.ts', 'desktop-control-style.ts', 'desktop-sidebar-footer.ts', 'desktop-sidebar-tree.ts',
  'desktop-live-sidebar.ts', 'desktop-theme.ts', 'desktop-theme-layers.tsx', 'desktop-theme-art.ts', 'desktop-ui-controller.ts',
  'desktop-ui-transport.ts', 'desktop-contract.ts', 'assets/desktop/sidebar-icon.png', 'DSH-ICONS-LICENSE.txt', 'tsconfig.json'];
const ui = join(dir, 'ui');
await mkdir(join(ui, 'assets/desktop'), { recursive: true });
const viewInputs = {};
for (const file of view) {
  const dst = join(ui, file);
  await copyFile(join(probe, file), dst);
  viewInputs[file] = await record(dst);
}
const entry = join(ui, 'App.tsx');
if (scripted) await copyFile(join(probe, 'appkit-hostcheck/ChatCheck.tsx'), entry);
else await writeFile(entry, "import { mount } from 'nsh';\nimport { DesktopView } from './DesktopView';\nmount(() => <DesktopView persistentHistory />);\n");
const config = { name: '沐码', id, version: '1.0.0', build: 1,
  capabilities: { host: [...methods, ...(scripted ? ['n01.complete'] : [])], statusBar: true } };
await writeFile(join(ui, 'nsh.json'), JSON.stringify(config));
// Pass an existing compiler explicitly: `nsh check` otherwise downloads on cache miss.
const tsc = join(homedir(), 'Library/Caches/nsh/typescript-7.0.2-darwin-arm64/package/lib/tsc');
assert.ok((await lstat(tsc)).isFile(), 'Cached NSH TypeScript 7.0.2 compiler required');
for (const [label, args] of [['tsx-check', ['check', '.', '--tsc', tsc]], ['tsx-build', ['build', '.', '--release', '-o', 'build']]]) {
  try { await writeFile(join(dir, `${label}.log`), run(nsh, args, { cwd: ui })); }
  catch (e) {
    await writeFile(join(dir, `${label}.log`), `${e.stdout ?? ''}\n${e.stderr ?? ''}`);
    throw Error(`${label} failed; see local log`);
  }
}
const staging = join(dir, '沐码.app'), contents = join(staging, 'Contents'), resources = join(contents, 'Resources');
const macos = join(contents, 'MacOS'), executable = 'AppKitPI', dylib = 'libN01AppKitPipe.dylib';
await mkdir(join(resources, 'ui'), { recursive: true });
await mkdir(macos);
for (const file of ['bundle.js', 'app.json', 'capabilities.json']) await copyFile(join(ui, 'build', file), join(resources, 'ui', file));
await cp(join(ui, 'build/assets'), join(resources, 'ui/assets'), { recursive: true });
await copyFile(join(ui, 'DSH-ICONS-LICENSE.txt'), join(resources, 'DSH-ICONS-LICENSE.txt'));
for (const file of [executable, dylib]) await copyFile(join(build, file), join(macos, file));
const plist = join(contents, 'Info.plist');
run('/usr/bin/plutil', ['-create', 'xml1', plist]);
for (const [name, value] of Object.entries({ CFBundleExecutable: executable, CFBundleIdentifier: id,
  CFBundleName: 'MuMa', CFBundleDisplayName: '沐码', CFBundleIconFile: 'moos.icns', CFBundlePackageType: 'APPL',
  CFBundleShortVersionString: '1.0.0', CFBundleVersion: '1' })) run('/usr/bin/plutil', ['-insert', name, '-string', value, plist]);
run('/usr/bin/plutil', ['-insert', 'N01ScriptedCheck', '-bool', String(scripted), plist]);
const inputs = Object.fromEntries(await Promise.all(hostFiles.map(async file => [file, await record(file)])));
const runtimeRecord = async path => ({ sha256: await record(path) });
const runtimeInputs = Object.fromEntries(Object.entries(inputs).map(([file, sha256]) => [file, { sha256 }]));
await packageRuntime({ app: staging, node: process.execPath, dir, check: true, run, record: runtimeRecord, inputs: runtimeInputs });
run('/usr/bin/codesign', ['--force', '--sign', '-', join(macos, dylib)]);
run('/usr/bin/codesign', ['--force', '--sign', '-', staging]);
await verifyInternalLinks(staging);
const verify = path => {
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', path]);
  return verifyPackageIdentity(path, id);
};
verify(staging);
// Fresh, owned temporary root for each build/mode. Never reuse formal data or
// co-locate the check and interactive apps with the same synthetic profile.
const destination = await mkdtemp(`/private/tmp/n01-appkit-chat-${scripted ? 'check' : 'interactive'}-`);
await writeFile(join(dir, 'relocation.txt'), `${destination}\n`);
const app = join(destination, '沐码.app');
await rename(staging, app);
for (const part of ['profile', 'storage']) await mkdir(join(destination, part), { mode: 0o700 });
const identity = verify(app);
const binary = join(app, 'Contents/MacOS', executable);
assert.equal(run(join(app, 'Contents/MacOS/moos-node'), ['--version']).trim(), process.version);
const receipt = { builtAt: new Date().toISOString(), head: run('/usr/bin/git', ['rev-parse', 'HEAD']).trim(),
  platform: run('/usr/bin/sw_vers', ['-productVersion']).trim(), arch: process.arch, nsh: version, node: process.version,
  identity, mode, fixtureOnly: true, installed: false, signed: 'ad-hoc deep strict', foreground: false, launches: [],
  upstreamRequests: 0, nativeBuild: relative(process.cwd(), build), viewInputs, hostInputs: inputs, entry: await record(entry),
  runner: await record(binary), resources: config.capabilities };
if (scripted) {
  // An accidental double-click/direct launch without the argument runs no fixture tasks.
  const rejected = spawnSync(binary, [], { cwd: destination, env, encoding: 'utf8', timeout: 5000 });
  const rejection = `${rejected.stdout ?? ''}${rejected.stderr ?? ''}`;
  await writeFile(join(dir, 'launch-refused.log'), rejection);
  assert.equal(rejected.status, 1);
  assert.match(rejection, /launch mode mismatch/);
  for (const [name, restart] of [['first', false], ['reopened', true]]) {
    const result = spawnSync(binary, ['--check'], { cwd: destination, env, encoding: 'utf8', timeout: 100000, killSignal: 'SIGKILL' });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    await writeFile(join(dir, `${name}.log`), output);
    assert.equal(result.status, 0, `${name} failed (signal=${result.signal}); see local log`);
    assert.match(output, /N01_HOST_EXIT 0 forced=false stderrBytes=0/);
    assert.doesNotMatch(output, /N01_APPKIT_CHAT_FAILED/);
    const report = JSON.parse(output.match(/^(?:INFO js: )?N01_APPKIT_CHAT (\{.*\})$/m)?.[1] ?? 'null');
    assert.equal(report?.restart, restart);
    assert.deepEqual(report.checks, ['fixture catalog', 'no replay before Send', ...(restart
      ? ['exact pre-Send history', 'old rows laid out', 'other project stays empty', 'scope round trip', 'PI continued from prior context']
      : ['empty profile', 'first public reply']), 'live rows not duplicated by history', ...(restart
      ? ['controller observes terminal backlog', 'terminal backlog blocks Send until drained', 'resend write/read on original scope'] : []), 'no polling after drain']);
    assert.match(report.scope.projectId, /^[a-f0-9-]{36}$/);
    assert.match(report.scope.sessionId, /^[a-f0-9-]{36}$/);
    await assert.rejects(lstat(join(destination, 'profile/.n01-active')), { code: 'ENOENT' });
    receipt.launches.push(report);
  }
  assert.deepEqual(receipt.launches[0].scope, receipt.launches[1].scope);
  assert.equal(await readFile(join(destination, 'profile/workspace-0/result.txt'), 'utf8'), 'APPKIT_CHAT\n');
  const pid = Number(await readFile(join(destination, 'profile/workspace-0/fixture-hold.pid'), 'utf8'));
  assert.ok(Number.isInteger(pid) && pid > 1);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }); // read-only liveness check
  receipt.registeredToolGone = true;
  verify(app);
}
await writeFile(join(dir, 'result.json'), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(`Local AppKit chat package: ${app}`);
