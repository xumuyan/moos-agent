// Local fixture-only AppKit chat. Explicit --check runs the scripted window;
// --interactive only creates a locally signed app, never launches it.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { chmod, copyFile, cp, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hostFiles, packageRuntime, verifyInternalLinks, verifyPackageIdentity } from './desktop-package.mjs';
import { trimDependencyMaps } from './desktop-appkit-size.mjs';
import { pruneArm64DependencyPayload } from './desktop-appkit-prune.mjs';

import { parseArtRoot, prepareArtwork } from './desktop-theme-assets.mjs';

const probe = dirname(fileURLToPath(import.meta.url));
process.chdir(resolve(probe, '../..'));
process.umask(0o077);
assert.equal(process.platform, 'darwin');
assert.equal(process.arch, 'arm64');
assert.equal(process.version, 'v24.15.0');
const [mode, buildPath, ...args] = process.argv.slice(2);
const artRoot = parseArtRoot(args);
const extra = args.filter((arg, index) => arg !== '--art-root' && args[index - 1] !== '--art-root');
assert.ok(buildPath && new Set(extra).size === extra.length && extra.every(arg => ['--trim-maps', '--strip-node', '--prune-runtime'].includes(arg)) &&
  ['--check', '--interactive'].includes(mode),
  'Pass --check or --interactive, an ignored appkit-chat native build directory, and optional --trim-maps / --strip-node / --prune-runtime');
const trimMaps = extra.includes('--trim-maps');
const stripNode = extra.includes('--strip-node');
const pruneRuntime = extra.includes('--prune-runtime');
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
const methods = ['projects.list', 'sessions.list', 'sessions.create', 'sessions.history', 'tasks.submit', 'tasks.cancel', 'tasks.events', 'sessions.manage', 'models.manage', 'images.stage'];
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
if (artRoot) await prepareArtwork(artRoot, ui, JSON.parse(await readFile(join(probe, 'skin-source.json'), 'utf8')));
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
const deps = 'Contents/Resources/host/node_modules';
let removedMaps = 0;
if (trimMaps) {
  const removed = await trimDependencyMaps(join(staging, deps));
  assert.ok(removed.length > 0, 'No recognized dependency source maps to trim');
  removedMaps = removed.length;
  await writeFile(join(dir, 'trimmed-maps.json'), `${JSON.stringify(removed, null, 2)}\n`);
}
const pruned = pruneRuntime ? await pruneArm64DependencyPayload(join(staging, deps)) : [];
if (pruneRuntime) await writeFile(join(dir, 'pruned-runtime.json'), `${JSON.stringify(pruned, null, 2)}\n`);
const stagedNode = join(macos, 'moos-node');
let nodeStrip = null;
if (stripNode) {
  // Only touch the freshly copied runtime; keep external symbols for native addons.
  assert.equal(run('/usr/bin/lipo', ['-archs', stagedNode]).trim(), 'arm64');
  const exports = () => run('/usr/bin/dyld_info', ['-exports', stagedNode], { maxBuffer: 16 * 1024 * 1024 })
    .trimEnd().split('\n').slice(3).map(line => line.trim()).sort();
  const libraries = () => run('/usr/bin/otool', ['-L', stagedNode]);
  const original = await lstat(stagedNode);
  assert.ok(original.isFile() && original.nlink === 1, 'Expected a private regular Node copy');
  const nodeMode = original.mode & 0o777;
  const before = { bytes: original.size, sha256: await record(stagedNode), mode: nodeMode };
  const exported = exports(), linked = libraries();
  assert.ok(exported.some(line => line.endsWith(' _napi_get_version')), 'Expected a Node N-API export');
  run('/usr/bin/strip', ['-S', '-x', stagedNode]);
  await chmod(stagedNode, nodeMode); // strip's temporary file obeys the private build umask.
  run('/usr/bin/codesign', ['--force', '--sign', '-', stagedNode]);
  run('/usr/bin/codesign', ['--verify', '--strict', stagedNode]);
  assert.deepEqual(exports(), exported, 'Node dyld exports changed');
  assert.equal(libraries(), linked, 'Node dylink dependencies changed');
  const stripped = await stat(stagedNode);
  const after = { bytes: stripped.size, sha256: await record(stagedNode), mode: stripped.mode & 0o777 };
  assert.equal(after.mode, nodeMode);
  assert.ok(after.bytes < before.bytes, 'Stripped Node is not smaller');
  nodeStrip = { before, after, exportCount: exported.length, exportsSha256: createHash('sha256').update(exported.join('\n')).digest('hex') };
}
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
// Archive only the signed .app, before creating any writable state. Run the
// extracted copy, so archive loss of executable modes, links or seals fails.
const zip = join(dir, 'MuMa-AppKit-Chat.zip');
run('/usr/bin/ditto', ['-c', '-k', '--keepParent', staging, zip]);
run('/usr/bin/ditto', ['-x', '-k', zip, destination]);
assert.deepEqual(await readdir(destination), ['沐码.app']);
await verifyInternalLinks(app);
const identity = verify(app);
for (const { path } of pruned) await assert.rejects(lstat(join(app, deps, path)), { code: 'ENOENT' });
await rm(staging, { recursive: true }); // Only our fresh build inside dir.
for (const part of ['profile', 'storage']) await mkdir(join(destination, part), { mode: 0o700 });
const binary = join(app, 'Contents/MacOS', executable);
const packagedNode = join(app, 'Contents/MacOS/moos-node');
assert.equal(run(packagedNode, ['--version']).trim(), process.version);
const nodeSha256 = await record(packagedNode);
if (nodeStrip) {
  const relocated = await stat(packagedNode);
  assert.deepEqual({ bytes: relocated.size, sha256: nodeSha256, mode: relocated.mode & 0o777 }, nodeStrip.after);
}
const kib = path => Number(run('/usr/bin/du', ['-sk', path]).trim().split(/\s+/)[0]);
const receipt = { builtAt: new Date().toISOString(), head: run('/usr/bin/git', ['rev-parse', 'HEAD']).trim(),
  platform: run('/usr/bin/sw_vers', ['-productVersion']).trim(), arch: process.arch, nsh: version, node: process.version,
  identity, mode, fixtureOnly: scripted, configuredModelsSupported: true, installed: false, signed: 'ad-hoc deep strict', foreground: false, artwork: !!artRoot, launches: [],
  upstreamRequests: scripted ? 0 : null, nativeBuild: relative(process.cwd(), build), viewInputs, hostInputs: inputs, entry: await record(entry),
  runner: await record(binary), resources: config.capabilities, trimMaps, removedMaps, nodeSha256, nodeStrip,
  pruneRuntime, prunedFiles: pruned.length,
  sizes: { bundleKiB: kib(app), nodeKiB: kib(join(app, 'Contents/MacOS/moos-node')), dependencyKiB: kib(join(app, deps)),
    zipBytes: (await stat(zip)).size }, extractedFromZip: true };
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
      ? ['controller observes terminal backlog', 'terminal backlog blocks Send until drained', 'resend write/read on original scope'] : []), 'no polling after drain',
      ...(restart ? ['team goal repairs then independently completes', 'team goal pauses after owned tool drains', 'team goal resumes the same objective',
        'clipboard image handed to PI', 'native model configuration', 'native session rename command'] : [])]);
    assert.match(report.scope.projectId, /^[a-f0-9-]{36}$/);
    assert.match(report.scope.sessionId, /^[a-f0-9-]{36}$/);
    await assert.rejects(lstat(join(destination, 'profile/.n01-active')), { code: 'ENOENT' });
    receipt.launches.push(report);
  }
  assert.deepEqual(receipt.launches[0].scope, receipt.launches[1].scope);
  assert.equal(await readFile(join(destination, 'profile/workspace-0/result.txt'), 'utf8'), 'APPKIT_CHAT\n');
  assert.equal(await readFile(join(destination, 'profile/workspace-0/team-goal-result.txt'), 'utf8'), 'goal-complete\n');
  const pid = Number(await readFile(join(destination, 'profile/workspace-0/fixture-hold.pid'), 'utf8'));
  assert.ok(Number.isInteger(pid) && pid > 1);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }); // read-only liveness check
  receipt.registeredToolGone = true;
  if (pruneRuntime) {
    // Keep test assets outside the signed bundle; all actual PI/Host code and
    // runtime dependencies load from the extracted package.
    const host = join(app, 'Contents/Resources/host');
    const url = path => pathToFileURL(join(host, path)).href;
    const routes = (await readFile(join(probe, 'desktop-live-models.mjs'), 'utf8'))
      .replace("'../../packages/pi-adapter/index.mjs'", JSON.stringify(url('packages/pi-adapter/index.mjs')));
    const test = (await readFile(join(probe, 'desktop-live-models.test.mjs'), 'utf8'))
      .replace(/from '\.\/(desktop-host(?:-stdio)?\.mjs)'/g,
        (_, file) => `from ${JSON.stringify(url(`probes/nsh-validation/${file}`))}`);
    await writeFile(join(destination, 'desktop-live-models.mjs'), routes);
    const testFile = join(destination, 'dual-protocol.test.mjs');
    await writeFile(testFile, test);
    const result = spawnSync(packagedNode, ['--test', '--test-reporter=tap',
      '--test-name-pattern=private pipe . real PI SDK: both protocols', testFile],
    { cwd: destination, env, encoding: 'utf8', timeout: 45000 });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    await writeFile(join(dir, 'dual-protocol.log'), output);
    assert.equal(result.status, 0, 'Packaged PI loopback failed; see dual-protocol.log');
    assert.match(output, /^# pass 1$/m);
    assert.match(output, /^# fail 0$/m);
    receipt.dualProtocolLoopback = true;
  }
  verify(app);
}
await writeFile(join(dir, 'result.json'), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(`Local AppKit chat package: ${app}`);
