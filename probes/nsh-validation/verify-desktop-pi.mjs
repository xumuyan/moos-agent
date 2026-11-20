// Isolated candidate/acceptance builds only, never the installed Moos or phone.
import { execFileSync, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { parseArtRoot, prepareArtwork } from './desktop-theme-assets.mjs';
import { loadLiveModels } from './desktop-live-models.mjs';

process.chdir(fileURLToPath(new URL('../../', import.meta.url)));
process.umask(0o077);
const args = process.argv.slice(2), interactive = args.includes('--interactive'), buildOnly = args.includes('--build-only');
const live = args.includes('--live-models');
const artRoot = parseArtRoot(args);
assert.ok(!(interactive && buildOnly) && (!live || interactive || buildOnly) &&
  args.filter(a => a !== artRoot).every(a => ['--art-root', '--interactive', '--build-only', '--live-models'].includes(a)), 'Unknown/conflicting option');
// An explicit interactive launch may make billable requests on Send only.
// Refuse to launch with missing/invalid private config; build-only does not read it.
if (live && interactive) await loadLiveModels();
const run = (path, args, options = {}) => execFileSync(path, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 24 * 1024 * 1024, ...options });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const record = async path => { const bytes = await readFile(path); return { bytes: bytes.length, sha256: sha(bytes) }; };
const probe = resolve('probes/nsh-validation');
const tools = resolve('artifacts/nsh-validation/toolchain');
const base = resolve('artifacts/nsh-validation/pi-ui');
await mkdir(base, { recursive: true });
const dir = await mkdtemp(join(base, 'run-'));
console.log(`Evidence directory: ${dir}`);
const source = join(dir, 'source');
const nsh = join(tools, 'nsh/bin/nsh');
const app = join(dir, 'DesktopPI.app');
const executable = join(app, 'Contents/MacOS/DesktopPI');
const cases = ['isolated startup', 'native window layout', 'public text once', 'create selects clean session', 'real write/read', 'separate project', 'foreign task denied',
  'session round trip', 'real multi-page drain', 'working task stays scoped', 'working session restored', 'stop active command',
  'send again after stop', 'no polling after drain', 'active EOF drained', 'disconnect not success', 'JS waiters disposed'];
const view = ['DesktopView.tsx', 'DesktopSettings.tsx', 'DesktopComposerStatistics.tsx', 'desktop-composer-statistics.ts',
  'DesktopTurnQueue.tsx', 'desktop-turn-queue.ts', 'desktop-session-preview.ts', 'DesktopModelPicker.tsx', 'desktop-model-picker.ts',
  'DesktopIcon.tsx', 'desktop-icon-paths.ts', 'desktop-control-style.ts', 'desktop-sidebar-footer.ts', 'desktop-sidebar-tree.ts',
  'desktop-live-sidebar.ts', 'desktop-theme.ts', 'desktop-theme-layers.tsx', 'desktop-theme-art.ts', 'desktop-ui-controller.ts',
  'desktop-ui-transport.ts', 'desktop-contract.ts', 'assets/desktop/sidebar-icon.png', 'DSH-ICONS-LICENSE.txt', 'tsconfig.json'];
const native = ['DesktopPipe.swift', 'DesktopNativeBridge.swift', 'DesktopPIHost.swift'];
const methods = ['projects.list', 'sessions.list', 'sessions.create', 'tasks.submit', 'tasks.cancel', 'tasks.events'];
const acceptance = !buildOnly && !interactive;
const bundleIdentifier = live ? 'dev.muma.probe.nsh.piui.live' : 'dev.muma.probe.nsh.piui';
const script = live ? 'desktop-live-stdio.mjs' : 'desktop-host-stdio.mjs';
const json = (name, value) => writeFile(join(dir, name), JSON.stringify(value, null, 2) + '\n');
try {
  assert.equal(process.platform, 'darwin');
  assert.equal(process.arch, 'arm64');
  const version = run(nsh, ['--version']).trim();
  assert.equal(version, 'nsh 0.5.0 (f4d68f7)');
  const archive = join(tools, 'nsh-embed-ios.zip');
  assert.equal((await record(archive)).sha256, '2bd3b84ffa72e6fd302b6e1722995cc1800270243f513111b13a2f291d63cd7d');
  const framework = join(tools, 'embed-catalyst/NativeShell.framework');
  const frameworkHash = run('/usr/bin/python3', ['-c', 'import hashlib,sys,zipfile;print(hashlib.sha256(zipfile.ZipFile(sys.argv[1]).read("nsh-embed-ios/NativeShell.xcframework/ios-arm64-maccatalyst/NativeShell.framework/Versions/A/NativeShell")).hexdigest())', archive]).trim();
  assert.equal((await record(join(framework, 'NativeShell'))).sha256, frameworkHash);
  await mkdir(join(source, 'assets/desktop'), { recursive: true });
  const inputs = {};
  for (const file of [...view, ...native, 'desktop-pi-check.tsx', 'verify-desktop-pi.mjs', 'desktop-theme-assets.mjs', 'skin-source.json',
    'desktop-host-stdio.mjs', 'desktop-host.mjs', 'desktop-model-fixture.mjs', 'desktop-statistics.mjs', 'desktop-profile.mjs',
    'desktop-live-stdio.mjs', 'desktop-live-models.mjs']) {
    inputs[`probes/nsh-validation/${file}`] = await record(join(probe, file));
  }
  for (const file of ['package-lock.json', ...run('git', ['ls-files', 'services/agent', 'packages/pi-runtime', 'packages/pi-adapter']).trim().split('\n')]) inputs[file] = await record(resolve(file));
  for (const file of view) await cp(join(probe, file), join(source, file));
  if (artRoot) await prepareArtwork(artRoot, source, JSON.parse(await readFile(join(probe, 'skin-source.json'), 'utf8')));
  if (acceptance) await cp(join(probe, 'desktop-pi-check.tsx'), join(source, 'App.tsx'));
  else await writeFile(join(source, 'App.tsx'), "import { mount } from 'nsh';\nimport { DesktopView } from './DesktopView';\nmount(DesktopView);\n");
  await writeFile(join(source, 'nsh.json'), JSON.stringify({ name: live ? 'NSH 候选 · 独立双模型' : 'NSH 候选 · PI 本地夹具', id: bundleIdentifier,
    capabilities: { statusBar: true, host: [...methods, ...(acceptance ? ['piui.disconnect', 'piui.report'] : [])] } }));
  const node = await realpath(process.execPath);
  const fixed = join(dir, 'DesktopFixedLaunch.swift');
  await writeFile(fixed, `enum DesktopFixedLaunch { static let node = ${JSON.stringify(node)}; static let script = ${JSON.stringify(join(probe, script))} }\n`);
  await json('inputs.json', { at: new Date().toISOString(), head: run('git', ['rev-parse', 'HEAD']).trim(), status: run('git', ['status', '--short']),
    node: process.version, nsh: version, system: run('/usr/bin/sw_vers', []), arch: process.arch, frameworkHash,
    acceptance, modelMode: live ? 'external' : 'fixture', artwork: !!artRoot, inputs, entry: await record(join(source, 'App.tsx')), config: await record(join(source, 'nsh.json')) });
  async function logged(label, command, params, timeout) {
    try { await writeFile(join(dir, `${label}.log`), run(command, params, { timeout })); }
    catch (error) {
      await writeFile(join(dir, `${label}.log`), `${error.stdout ?? ''}\n${error.stderr ?? ''}`);
      throw Error(`${label} failed; see ${dir}/${label}.log`);
    }
  }
  await logged('check', nsh, ['check', source], 60000);
  const bundle = join(dir, 'bundle');
  await logged('bundle', nsh, ['build', join(source, 'App.tsx'), '--release', '--out', bundle], 120000);
  assert.ok((await record(join(bundle, 'bundle.nshc'))).bytes > 0);
  const project = { name: 'DesktopPI', targets: { DesktopPI: { type: 'application', platform: 'iOS', deploymentTarget: '15.0',
    sources: [...native.map(file => join(probe, file)), fixed], dependencies: [{ framework, embed: false }],
    info: { path: 'Info.plist', properties: { UIApplicationSceneManifest: { UIApplicationSupportsMultipleScenes: false, UISceneConfigurations: {} } } },
    settings: { base: { PRODUCT_BUNDLE_IDENTIFIER: bundleIdentifier, GENERATE_INFOPLIST_FILE: 'YES', SUPPORTS_MACCATALYST: 'YES',
      DERIVE_MACCATALYST_PRODUCT_BUNDLE_IDENTIFIER: 'NO', SWIFT_VERSION: '5.0', SWIFT_ACTIVE_COMPILATION_CONDITIONS: acceptance ? 'PI_UI_CHECK' : '',
      CODE_SIGNING_ALLOWED: 'NO', ENABLE_APP_SANDBOX: 'NO', TARGETED_DEVICE_FAMILY: '2', INFOPLIST_KEY_UILaunchScreen_Generation: 'YES' } },
  } } };
  await json('project.json', project);
  await logged('project', '/opt/homebrew/bin/xcodegen', ['generate', '--spec', join(dir, 'project.json')], 30000);
  const derived = join(dir, 'DerivedData');
  await logged('build', '/usr/bin/xcodebuild', ['-project', join(dir, 'DesktopPI.xcodeproj'), '-scheme', 'DesktopPI', '-configuration', 'Release',
    '-destination', 'platform=macOS,variant=Mac Catalyst,arch=arm64', '-derivedDataPath', derived, 'CODE_SIGNING_ALLOWED=NO', 'build'], 180000);
  await cp(join(derived, 'Build/Products/Release-maccatalyst/DesktopPI.app'), app, { recursive: true, verbatimSymlinks: true });
  await cp(bundle, join(app, 'Contents/Resources/ui'), { recursive: true });
  run('/usr/bin/codesign', ['--force', '--sign', '-', app]);
  run('/usr/bin/codesign', ['--verify', '--strict', app]);
  console.log(`Candidate app: ${app}`);
  for (const [file, expected] of Object.entries(inputs)) assert.deepEqual(await record(resolve(file)), expected, `Input changed: ${file}`);
  if (!buildOnly) {
    const openArgs = ['-n', ...(acceptance ? ['-W', '-g', '-j'] : []), '--stdout', join(dir, 'stdout.log'), '--stderr', join(dir, 'stderr.log'), app];
    const opened = spawn('/usr/bin/open', openArgs, { stdio: 'ignore' });
    await new Promise((resolve, reject) => {
      // Outer watchdog also covers a hung native main thread. Only signal our exact executable.
      const deadline = setTimeout(async () => {
        try {
          const pid = Number(await readFile(join(dir, 'app.pid'), 'utf8'));
          if (Number.isSafeInteger(pid) && pid > 1 && run('/bin/ps', ['-p', String(pid), '-o', 'command=']).trim() === executable) process.kill(pid, 'SIGTERM');
        } catch { /* already exited or unverified PID; never signal another instance */ }
        opened.kill('SIGTERM');
        reject(Error('Candidate launch deadline; not accepted'));
      }, acceptance ? 85000 : 15000);
      opened.once('error', error => { clearTimeout(deadline); reject(error); });
      opened.once('close', code => { clearTimeout(deadline); code === 0 ? resolve() : reject(Error(`Launch exit: ${code}`)); });
    });
  }
  if (acceptance) {
    const result = JSON.parse(await readFile(join(dir, 'result.json'), 'utf8'));
    console.log(JSON.stringify(result));
    assert.equal(result.passed, true, `Candidate stopped at ${result.stage}`);
    assert.equal(result.normalChildExit, true);
    assert.equal(result.forced, false);
    assert.equal(result.stderrBytes, 0);
    assert.deepEqual(result.checks, cases);
    assert.ok(result.backlogEvents > 150 && result.backlogPolls >= 2);
  } else {
    const status = { built: true, launched: interactive, installed: false, acceptance: false };
    await json('build-result.json', status);
    console.log(JSON.stringify(status));
  }
} catch (error) {
  await writeFile(join(dir, 'failure.txt'), String(error));
  throw error;
}
