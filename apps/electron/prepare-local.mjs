import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = dirname(fileURLToPath(import.meta.url));
const repo = join(source, '..', '..');
const localDsh = join(homedir(), 'Library/Application Support/dev.moos.agent.build-sources/DeepSeek Harness.app');
const defaultDsh = existsSync(localDsh) ? localDsh : '/Applications/DeepSeek Harness.app';
const dshApp = join(resolve(process.env.MOOS_ELECTRON_DSH_APP ?? defaultDsh), 'Contents');
const upstream = join(dshApp, 'MacOS', 'DeepSeek Harness');
const dshVersion = execFileSync('/usr/libexec/PlistBuddy',
  ['-c', 'Print CFBundleShortVersionString', join(dshApp, 'Info.plist')], { encoding: 'utf8' }).trim();
if (dshVersion !== '0.2.2-rc.1') throw new Error('The local Electron build requires DSH Desktop 0.2.2-rc.1');

const output = join(repo, '.generated', 'moos-electron');
await mkdir(output, { recursive: true, mode: 0o700 });
const build = await mkdtemp(join(output, 'build-'));
const bundle = join(build, '沐码.app');
const electronContents = process.env.MOOS_ELECTRON_DIST
  ? join(process.env.MOOS_ELECTRON_DIST, 'Contents') : dshApp;
const executable = execFileSync('/usr/libexec/PlistBuddy',
  ['-c', 'Print CFBundleExecutable', join(electronContents, 'Info.plist')], { encoding: 'utf8' }).trim();
const electronVersion = execFileSync(join(electronContents, 'MacOS', executable),
  ['-p', 'process.versions.electron'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8',
  }).trim();
if (electronVersion !== '44.7.0') throw new Error('The local build requires Electron 44.7.0');
const contents = join(bundle, 'Contents');
const resources = join(contents, 'Resources');
await mkdir(resources, { recursive: true });
// Copy only the Electron launcher and framework. The shell below is Moos' own entry point.
for (const entry of ['MacOS', 'Frameworks', 'Info.plist', 'PkgInfo']) {
  execFileSync('/usr/bin/ditto', [join(electronContents, entry), join(contents, entry)]);
}
const hostRuntime = join(resources, 'host-runtime');
execFileSync(upstream, [join(source, 'stage-dsh-runtime.cjs'), hostRuntime], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
});
await cp(join(source, 'dsh-cli.mjs'), join(hostRuntime, 'cli.mjs'));
await mkdir(join(hostRuntime, 'bin'));
const cli = join(hostRuntime, 'bin', 'dsh');
await cp(join(source, 'dsh-launcher.sh'), cli);
await chmod(cli, 0o755);

const template = join(resources, 'profile-template');
await mkdir(template, { mode: 0o700 });
const env = { ...process.env, DSH_HOME: template, DSH_TELEMETRY_DISABLED: '1', ELECTRON_RUN_AS_NODE: '1' };
const runBuildCli = (args, options) => execFileSync(upstream,
  ['--expose-internals', join(hostRuntime, 'cli.mjs'), ...args], { ...options, env });
runBuildCli(['web', '--dump-config'], { cwd: build, stdio: ['ignore', 'ignore', 'inherit'] });
const webProfile = join(template, 'profiles', 'web');
const bundles = join(webProfile, 'local-bundles');
await mkdir(bundles, { recursive: true });
const stagedPlugin = join(build, 'shell-plugin');
await cp(join(source, 'plugin'), stagedPlugin, { recursive: true });
const pluginClient = join(stagedPlugin, 'client.js');
const sidebarIcon = await readFile(join(source, 'assets', 'sidebar-icon.png'));
const clientSource = await readFile(pluginClient, 'utf8');
await writeFile(pluginClient, clientSource.replace('__MOOS_SIDEBAR_ICON__', sidebarIcon.toString('base64')));
const archive = execFileSync('npm', ['pack', stagedPlugin, '--pack-destination', bundles, '--silent'],
  { encoding: 'utf8' }).trim();
runBuildCli(['plugin', '--profile', 'web', 'add', `file:./local-bundles/${archive}`,
  '@linxin666/dsh-client-ui-skin-center@0.4.5', '--save-exact'],
{ cwd: webProfile, stdio: 'inherit' });

// The CLI expands tarball specs from its invocation directory. Keep the seeded
// profile movable between the signed app resources and the user's data folder.
const profileManifest = join(webProfile, 'package.json');
const profile = JSON.parse(await readFile(profileManifest, 'utf8'));
const originalSpec = profile.dependencies['moos-electron-shell'];
const relativeSpec = `file:local-bundles/${archive}`;
if (typeof originalSpec !== 'string' || !originalSpec.startsWith('file:') || !originalSpec.endsWith(archive)) {
  throw new Error('The Moos plugin package was not installed into the profile template');
}
if (originalSpec !== relativeSpec) {
  const lock = join(webProfile, 'pnpm-lock.yaml');
  const lockText = await readFile(lock, 'utf8');
  if (!lockText.includes(originalSpec)) throw new Error('Moos plugin spec missing from the profile lock');
  profile.dependencies['moos-electron-shell'] = relativeSpec;
  await writeFile(profileManifest, JSON.stringify(profile, null, 2) + '\n');
  await writeFile(lock, lockText.replaceAll(originalSpec, relativeSpec));
}

const appSource = join(resources, 'app');
await mkdir(appSource);
const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
await writeFile(join(appSource, 'package.json'), JSON.stringify({
  name: manifest.name, productName: manifest.productName, version: manifest.version,
  main: manifest.main, type: manifest.type,
}));
for (const file of ['main.mjs', 'host.mjs', 'link-handler.mjs', 'pi-usage.mjs', 'pi-turn.mjs', 'profile-home.mjs', 'shell-update.mjs', 'window-preload.cjs']) {
  await cp(join(source, file), join(appSource, file));
}
await cp(join(source, 'plugin/pi-models.js'), join(appSource, 'pi-models.js'));
await mkdir(join(appSource, 'plugin'));
await cp(join(source, 'plugin/pi-workspace-changes.js'), join(appSource, 'plugin/pi-workspace-changes.js'));
// M06 桌面操作 helper：Swift 源随仓库，构建时编译为 Resources/bin 下的独立可执行文件。
{
  const helperBin = join(resources, 'bin');
  await mkdir(helperBin);
  const helperSource = join(source, 'desktop-helper.swift');
  execFileSync('/usr/bin/swiftc', ['-O', '-target', 'arm64-apple-macos14',
    '-o', join(helperBin, 'moos-desktop-helper'), helperSource], { stdio: 'inherit' });
  await chmod(join(helperBin, 'moos-desktop-helper'), 0o755);
  const version = execFileSync(join(helperBin, 'moos-desktop-helper'), ['version'], { encoding: 'utf8' });
  if (!version.includes('"version":"1"')) throw new Error('desktop helper smoke check failed');
}
const includesPiFixture = process.env.MOOS_ELECTRON_INCLUDE_PI_FIXTURE === '1';
await writeFile(join(resources, 'moos-runtime.json'), JSON.stringify({ dshVersion, includesPiFixture }));
await cp(join(source, 'execution.patch.yml'), join(resources, 'execution.patch.yml'));
{
  const runtime = join(resources, 'pi-runtime');
  await mkdir(runtime);
  for (const file of ['package.json', 'package-lock.json']) await cp(join(repo, file), join(runtime, file));
  execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
    { cwd: runtime, stdio: 'inherit' });
  for (const file of ['packages/pi-runtime/sdk-runtime.mjs', 'packages/pi-runtime/image-tool.mjs', 'packages/pi-runtime/tool-policy.mjs', 'packages/pi-runtime/toolchain.mjs',
    'packages/pi-runtime/repair-routing.mjs', 'packages/pi-runtime/session-fork.mjs', 'packages/pi-adapter/index.mjs',
    'packages/pi-runtime/desktop-queue.mjs', 'packages/pi-runtime/desktop-tools.mjs',
    'services/agent/store.mjs', 'services/agent/scheduler.mjs',
    'services/agent/task-policy.mjs', 'services/agent/timeline-view.mjs', 'services/agent/errors.mjs',
    'services/agent/provider-diagnostics.mjs',
    'services/agent/usage.mjs']) {
    const destination = join(runtime, file);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(repo, file), destination);
  }
  if (includesPiFixture) {
    await cp(join(repo, 'services/agent/fixture.mjs'), join(runtime, 'services/agent/fixture.mjs'));
    await cp(join(source, 'pi-fixture.patch.yml'), join(runtime, 'profile.patch.yml'));
  }
}
await cp(join(source, 'assets', 'moos.icns'), join(resources, 'moos.icns'));

const setInfo = async (info, fields) => {
  await chmod(info, 0o644);
  for (const [key, value] of Object.entries(fields)) {
    execFileSync('/usr/bin/plutil', ['-replace', key, '-string', value, info]);
  }
};

const frameworks = join(contents, 'Frameworks');
for (const entry of await readdir(frameworks)) {
  if (!entry.endsWith('.app') || !entry.startsWith(executable + ' Helper')) continue;
  const oldName = entry.slice(0, -4);
  const suffix = oldName.slice(executable.length);
  const newName = 'MuMa' + suffix;
  const helper = join(frameworks, newName + '.app');
  await rename(join(frameworks, entry), helper);
  await rename(join(helper, 'Contents', 'MacOS', oldName), join(helper, 'Contents', 'MacOS', newName));
  const role = /\(([^)]+)\)$/.exec(suffix)?.[1].toLowerCase();
  await setInfo(join(helper, 'Contents', 'Info.plist'), {
    CFBundleName: newName, CFBundleDisplayName: newName, CFBundleExecutable: newName,
    CFBundleIdentifier: 'dev.moos.agent.electron.helper' + (role ? '.' + role : ''),
  });
}
await rename(join(contents, 'MacOS', executable), join(contents, 'MacOS', 'MuMa'));
const info = join(contents, 'Info.plist');
for (const key of ['CFBundleURLTypes', 'ElectronAsarIntegrity', 'SUFeedURL']) {
  try { execFileSync('/usr/bin/plutil', ['-remove', key, info], { stdio: 'ignore' }); }
  catch (error) { if (error.status !== 1) throw error; }
}
// Electron derives its Helper bundle prefix from CFBundleName; keep this technical name ASCII.
await setInfo(info, {
  CFBundleName: 'MuMa', CFBundleDisplayName: '沐码', CFBundleIdentifier: 'dev.moos.agent.electron',
  CFBundleExecutable: 'MuMa', CFBundleIconFile: 'moos.icns', CFBundleShortVersionString: manifest.version,
  CFBundleVersion: manifest.version,
});
// Localized display names do not change the stable bundle ID, partition or data directory.
for (const [locale, displayName] of [['en', '沐码'], ['zh-Hans', '沐码'], ['zh-Hant', '沐碼']]) {
  const localized = join(resources, locale + '.lproj');
  await mkdir(localized, { recursive: true });
  await writeFile(join(localized, 'InfoPlist.strings'), `"CFBundleDisplayName" = "${displayName}";\n`);
}
execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundle], { stdio: 'inherit' });
console.log(bundle);
