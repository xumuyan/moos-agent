// Reproducible isolated native transport + actual NSH/Swift/Catalyst -> Node/PI acceptance.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, cp, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
process.chdir(fileURLToPath(new URL('../../', import.meta.url)));
process.umask(0o077);
const root = process.cwd(), base = resolve('artifacts/nsh-validation/desktop-native');
await mkdir(base, { recursive: true });
const dir = await mkdtemp(join(base, 'run-'));
console.log(`Evidence directory: ${dir}`);
const node = await realpath(process.execPath);
const fixed = join(dir, 'DesktopFixedLaunch.swift');
await writeFile(fixed, `enum DesktopFixedLaunch { static let node = ${JSON.stringify(node)}; static let script = ${JSON.stringify(resolve('probes/nsh-validation/desktop-host-stdio.mjs'))}; static let stalledScript = ${JSON.stringify(join(dir, 'timeout.mjs'))} }\n`);
const common = `import readline from 'node:readline';\nconst lines = readline.createInterface({input:process.stdin});\nconst reply = r => JSON.stringify({version:1,id:r.id,ok:true,result:{echo:r.method}})+'\\n';\n`;
const fixtures = {
  reverse: `let held; lines.on('line', x=>{const r=JSON.parse(x); if(!held)held=r;else {process.stdout.write(reply(r)); process.stdout.write(reply(held));}});`,
  timeout: `lines.on('line',()=>{});`,
  oversize: `lines.once('line',()=>process.stdout.write('a'.repeat(524288)));`,
  badutf8: `lines.once('line',()=>process.stdout.write(Buffer.from([255,10])));`,
  unknown: `lines.once('line',()=>process.stdout.write(reply({id:'unknown',method:'x'})));`,
  duplicate: `lines.once('line',x=>{let r=JSON.parse(x); process.stdout.write(reply(r)+reply(r));});`,
  exit: `lines.once('line',()=>process.exit(7));`,
  'instant-exit': `process.exit(19);`,
  'ignore-term': `process.on('SIGTERM',()=>{}); setInterval(()=>{},1000); lines.once('line',x=>process.stdout.write(reply(JSON.parse(x))));`,
  partial: `lines.once('line',()=>{process.stdout.write('{');process.exit(0);});`,
  badversion: `lines.once('line',x=>process.stdout.write(JSON.stringify({version:true,id:JSON.parse(x).id,ok:true,result:{}})+'\\n'));`,
  badok: `lines.once('line',x=>process.stdout.write(JSON.stringify({version:1,id:JSON.parse(x).id,ok:1,result:{}})+'\\n'));`,
  baderror: `lines.once('line',x=>process.stdout.write(JSON.stringify({version:1,id:JSON.parse(x).id,ok:false,error:{code:'secret',path:'/private'}})+'\\n'));`,
  broken: `lines.on('line',x=>process.stdout.write(reply(JSON.parse(x))));`,
  limit: `lines.on('line',x=>process.stdout.write(reply(JSON.parse(x))));`,
  deinit: `lines.on('line',x=>process.stdout.write(reply(JSON.parse(x))));`,
  blocked: `process.stdin.pause(); setTimeout(()=>process.exit(0),1000);`,
};
for (const [name, code] of Object.entries(fixtures)) await writeFile(join(dir, name + '.mjs'), (name === 'blocked' ? '' : common) + code);
const run = (file, args, options = {}) => execFileSync(file, args, { cwd: root, maxBuffer: 20 * 1024 * 1024, ...options });
const sources = ['DesktopPipe.swift', 'DesktopNativeBridge.swift', 'DesktopBridgeCheck.swift'].map(x => resolve('probes/nsh-validation', x));
try {
  const binary = join(dir, 'pipe-check');
  run('/usr/bin/xcrun', ['swiftc', '-swift-version', '5', '-D', 'BRIDGE_CHECK', '-parse-as-library', sources[0], resolve('probes/nsh-validation/DesktopPipeCheck.swift'), fixed, '-o', binary]);
  const native = run(binary, [dir], { timeout: 60000, encoding: 'utf8' });
  await writeFile(join(dir, 'native.json'), native); console.log(native.trim());
  if (process.argv.includes('--native-only')) process.exit(0);
  const nsh = resolve('artifacts/nsh-validation/toolchain/nsh/bin/nsh');
  assert.equal(run(nsh, ['--version'], { encoding: 'utf8' }).trim(), 'nsh 0.5.0 (f4d68f7)');
  assert.equal(createHash('sha256').update(await readFile(resolve('artifacts/nsh-validation/toolchain/nsh-embed-ios.zip'))).digest('hex'), '2bd3b84ffa72e6fd302b6e1722995cc1800270243f513111b13a2f291d63cd7d');
  const framework = resolve('artifacts/nsh-validation/toolchain/embed-catalyst/NativeShell.framework');
  const frameworkBinary = await readFile(join(framework, 'NativeShell'));
  // Verify the extracted executable, not merely the unmodified archive beside it.
  const archiveHash = run('/usr/bin/python3', ['-c', 'import zipfile,hashlib,sys; z=zipfile.ZipFile(sys.argv[1]); print(hashlib.sha256(z.read(sys.argv[2])).hexdigest())', resolve('artifacts/nsh-validation/toolchain/nsh-embed-ios.zip'), 'nsh-embed-ios/NativeShell.xcframework/ios-arm64-maccatalyst/NativeShell.framework/Versions/A/NativeShell'], { encoding: 'utf8' }).trim();
  assert.equal(createHash('sha256').update(frameworkBinary).digest('hex'), archiveHash);
  for (const scenario of ['good', 'denied', 'timeout']) {
    const source = join(dir, scenario + '-src'); await mkdir(source);
    await cp(resolve('probes/nsh-validation/desktop-native-check.tsx'), join(source, 'App.tsx'));
    await cp(resolve('probes/nsh-validation/desktop-contract.ts'), join(source, 'desktop-contract.ts'));
    await writeFile(join(source, 'nsh.json'), JSON.stringify({ name: 'Desktop native check', id: 'dev.muma.probe.nsh.desktop.' + scenario, capabilities: { host: ['check.report', ...(scenario !== 'denied' ? ['check.destroy', 'check.ready', 'projects.list', 'sessions.list', 'sessions.create', 'tasks.submit', 'tasks.cancel', 'tasks.events'] : [])] } }));
    run(nsh, ['build', join(source, 'App.tsx'), '--release', '--out', join(dir, scenario)]);
  }
  const project = { name: 'DesktopNativeCheck', targets: { DesktopNativeCheck: {
    type: 'application', platform: 'iOS', deploymentTarget: '15.0', sources: [...sources, fixed],
    dependencies: [{ framework, embed: false }],
    info: { path: 'Info.plist', properties: { UIApplicationSceneManifest: { UIApplicationSupportsMultipleScenes: false, UISceneConfigurations: {} } } },
    settings: { base: { PRODUCT_BUNDLE_IDENTIFIER: 'dev.muma.probe.nsh.desktopnativecheck', GENERATE_INFOPLIST_FILE: 'YES', SUPPORTS_MACCATALYST: 'YES', DERIVE_MACCATALYST_PRODUCT_BUNDLE_IDENTIFIER: 'NO', SWIFT_VERSION: '5.0', SWIFT_ACTIVE_COMPILATION_CONDITIONS: 'BRIDGE_CHECK', CODE_SIGNING_ALLOWED: 'NO', ENABLE_APP_SANDBOX: 'NO', TARGETED_DEVICE_FAMILY: '2', INFOPLIST_KEY_UILaunchScreen_Generation: 'YES' } }
  } } };
  await writeFile(join(dir, 'project.json'), JSON.stringify(project));
  run('/opt/homebrew/bin/xcodegen', ['generate', '--spec', join(dir, 'project.json')]);
  try { await writeFile(join(dir, 'build.log'), run('/usr/bin/xcodebuild', ['-project', join(dir, 'DesktopNativeCheck.xcodeproj'), '-scheme', 'DesktopNativeCheck', '-configuration', 'Release', '-destination', 'platform=macOS,variant=Mac Catalyst,arch=arm64', '-derivedDataPath', join(dir, 'DerivedData'), 'CODE_SIGNING_ALLOWED=NO', 'build'], { timeout: 240000 })); }
  catch (error) { await writeFile(join(dir, 'build.log'), Buffer.concat([error.stdout ?? Buffer.alloc(0), error.stderr ?? Buffer.alloc(0)])); throw new Error(`Build failed: ${dir}/build.log`); }
  const app = join(dir, 'DerivedData/Build/Products/Release-maccatalyst/DesktopNativeCheck.app');
  for (const scenario of ['good', 'denied', 'timeout']) await cp(join(dir, scenario), join(app, 'Contents/Resources', scenario), { recursive: true });
  run('/usr/bin/codesign', ['--force', '--sign', '-', app]);
  if (process.argv.includes('--build-only')) {
    console.log(JSON.stringify({ built: true, app, installed: false, executed: false, platform: 'Mac Catalyst' }));
    process.exit(0);
  }
  const launch = async (runtimeDir, exitCheck = false) => new Promise((done, reject) => {
    const child = spawn('/usr/bin/open', ['-W', '-n', '-g', '-j', '--env', `N01_DESKTOP_CHECK_DIR=${runtimeDir}`, '--env', `N01_DESKTOP_EXIT_CHECK=${exitCheck ? 1 : 0}`, '--stdout', join(runtimeDir, 'stdout.log'), '--stderr', join(runtimeDir, 'stderr.log'), app], { stdio: 'ignore' });
    const timer = setTimeout(async () => {
      try {
        const pid = Number(await readFile(join(runtimeDir, 'app.pid'), 'utf8'));
        const command = run('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim();
        if (pid > 1 && command === join(app, 'Contents/MacOS/DesktopNativeCheck')) process.kill(pid, 'SIGTERM');
      } catch { /* no global process search or termination */ }
    }, 55000);
    const hardDeadline = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Owned runner did not close; inspect evidence, not accepted')); }, 85000);
    child.once('error', reject);
    child.once('close', code => { clearTimeout(timer); clearTimeout(hardDeadline); code === 0 ? done() : reject(new Error(`Runner exit ${code}`)); });
  });
  await launch(dir);
  const result = JSON.parse(await readFile(join(dir, 'result.json'), 'utf8'));
  assert.equal(result.passed, true); assert.equal(result.normalChildExit, true); assert.equal(result.forced, false);
  assert.ok(result.maxPending.some(x => x >= 2));
  console.log(JSON.stringify(result));
  const exitDir = join(dir, 'owner-exit'); await mkdir(exitDir);
  await launch(exitDir, true);
  const ownerExit = JSON.parse(await readFile(join(exitDir, 'result.json'), 'utf8'));
  assert.equal(ownerExit.passed, true); assert.equal(ownerExit.normalChildExit, true); assert.equal(ownerExit.forced, false);
  console.log(JSON.stringify({ ownerNormalExit: ownerExit }));
} catch (error) { await writeFile(join(dir, 'failure.txt'), String(error)); throw error; }
