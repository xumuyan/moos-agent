// Real NSH/Swift/Catalyst execution, not iPhone evidence. Only ephemeral loopback HTTPS.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:https';
import { createHash } from 'node:crypto';
import { lstatSync } from 'node:fs';
import assert from 'node:assert/strict';
process.chdir(fileURLToPath(new URL('../../', import.meta.url)));
process.umask(0o077);
const base = resolve('artifacts/nsh-validation');
const nsh = join(base, 'toolchain/nsh/bin/nsh');
assert.equal(execFileSync(nsh, ['--version'], { encoding: 'utf8' }).trim(), 'nsh 0.5.0 (f4d68f7)');
const framework = join(base, 'toolchain/embed-catalyst/NativeShell.framework');
const archive = join(base, 'toolchain/nsh-embed-ios.zip');
assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'), '2bd3b84ffa72e6fd302b6e1722995cc1800270243f513111b13a2f291d63cd7d');
// Flatten only regular files below Versions/A; never restore the archive's symlinks.
execFileSync('/usr/bin/python3', ['-c', `import zipfile,pathlib,stat,sys
z=zipfile.ZipFile(sys.argv[1]);out=pathlib.Path(sys.argv[2])
prefix='nsh-embed-ios/NativeShell.xcframework/ios-arm64-maccatalyst/NativeShell.framework/Versions/A/'
for i in z.infolist():
 if not i.filename.startswith(prefix) or i.is_dir():continue
 q=pathlib.PurePosixPath(i.filename[len(prefix):])
 assert not q.is_absolute() and '..' not in q.parts and not stat.S_ISLNK(i.external_attr>>16)
 t=out/str(q);t.parent.mkdir(parents=True,exist_ok=True);assert not t.is_symlink();t.write_bytes(z.read(i))
`, archive, framework], { stdio: 'pipe' });
assert.equal(lstatSync(framework).isSymbolicLink(), false);
await mkdir(join(base, 'bridge-runtime'), { recursive: true });
const dir = await mkdtemp(join(base, 'bridge-runtime/run-'));
let server;
const counts = { http: 0, closedBeforeResponse: 0 };
try {
  const openssl = (...args) => execFileSync('/usr/bin/openssl', args, { cwd: dir, stdio: 'pipe' });
  openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=N01-Runtime-CA');
  openssl('x509', '-in', 'ca.pem', '-outform', 'DER', '-out', 'ca.der');
  openssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=localhost');
  await writeFile(join(dir, 'ext.cnf'), 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost\n');
  openssl('x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'server.pem', '-days', '1', '-extfile', 'ext.cnf');
  openssl('x509', '-in', 'server.pem', '-outform', 'DER', '-out', 'server.der');
  server = createServer({ key: await readFile(join(dir, 'server.key')), cert: await readFile(join(dir, 'server.pem')), minVersion: 'TLSv1.2' }, (req, res) => {
    assert.equal(req.url, '/trust-check'); assert.equal(req.headers.authorization, undefined);
    counts.http++;
    // Request 1 completes; request 2 is cancelled; request 3 exceeds native request timeout.
    if (counts.http === 1) setTimeout(() => res.end('N01 pinned TLS OK'), 300);
    res.on('close', () => { if (!res.writableEnded) counts.closedBeforeResponse++; });
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  await writeFile(join(dir, 'config.json'), JSON.stringify({ url: `https://localhost:${server.address().port}/trust-check` }));
  const js = `import { host, mount, Text } from 'nsh';
mount(() => <Text>Isolated background bridge acceptance, not phone validation</Text>);
const scenario = host.params.scenario;
let checks = 0;
function check(value) { if (!value) throw new Error('assertion failed'); checks++; }
async function rejects(call, code) {
 try { await call(); } catch (error) {
  check(error.code === code);
  check(!String(error).includes('localhost') && !String(error).includes('certificate'));
  return;
 }
 throw new Error('unexpected success');
}
async function run() {
 if (scenario === 'denied') {
  await rejects(() => host.call('n01.trustCheck'), 'ERR_ACCESS_DENIED');
  await rejects(() => host.call('n01.cancelTrustCheck'), 'ERR_ACCESS_DENIED');
 } else if (scenario === 'wrongpin') {
  await rejects(() => host.call('n01.trustCheck'), 'ERR_NSH_HOST_ERROR');
 } else {
  await rejects(() => host.call('n01.trustCheck', { endpoint: 'https://malicious.invalid' }), 'ERR_NSH_HOST_ERROR');
  await rejects(() => host.call('n01.notGranted'), 'ERR_ACCESS_DENIED');
  await rejects(() => host.call('n01.noHandler'), 'ERR_NSH_HOST_ERROR');
  const pending = host.call('n01.trustCheck');
  await rejects(() => host.call('n01.trustCheck'), 'ERR_NSH_HOST_ERROR');
  const good = await pending; check(good.version === 1 && good.status === 'passed');
  const held = host.call('n01.trustCheck').then(() => false, error => error.code === 'ERR_NSH_HOST_ERROR');
  await new Promise(r => setTimeout(r, 300));
  const cancel = await host.call('n01.cancelTrustCheck'); check(cancel.cancelled === true);
  check(await held);
  const idle = await host.call('n01.cancelTrustCheck'); check(idle.cancelled === false);
  const before = Date.now();
  await rejects(() => host.call('n01.trustCheck', null, { timeout: 10000 }), 'ERR_NSH_HOST_ERROR');
  check(Date.now() - before >= 3500 && Date.now() - before < 10000);
 }
 await host.call('n01.report', { passed: true, scenario, checks });
}
run().catch(error => host.call('n01.report', { passed: false, scenario, checks, code: String(error.code), message: String(error.message) }));`;
  for (const name of ['good', 'wrongpin', 'denied']) {
    const source = join(dir, name + '-src'); await mkdir(source);
    await writeFile(join(source, 'App.tsx'), js);
    await writeFile(join(source, 'nsh.json'), JSON.stringify({ name: 'N01 bridge runtime ' + name, id: 'dev.muma.probe.nsh.runtime.' + name, capabilities: { host: name === 'denied' ? ['n01.report'] : ['n01.report', 'n01.trustCheck', 'n01.cancelTrustCheck', 'n01.noHandler'] } }));
    execFileSync(nsh, ['build', join(source, 'App.tsx'), '--release', '--out', join(dir, name)], { stdio: 'pipe' });
  }
  const sources = ['BridgeRuntimeCheck.swift', 'PinnedTLS.swift', 'PinnedTLSBridge.swift'].map(p => resolve('probes/nsh-validation', p));
  const project = { name: 'N01RuntimeCheck', targets: { N01RuntimeCheck: {
    type: 'application', platform: 'iOS', deploymentTarget: '15.0', sources,
    dependencies: [{ framework, embed: false }],
    info: { path: 'Info.plist', properties: { UIApplicationSceneManifest: { UIApplicationSupportsMultipleScenes: false, UISceneConfigurations: {} } } },
    settings: { base: { PRODUCT_BUNDLE_IDENTIFIER: 'dev.muma.probe.nsh.runtimecheck', GENERATE_INFOPLIST_FILE: 'YES', SUPPORTS_MACCATALYST: 'YES', DERIVE_MACCATALYST_PRODUCT_BUNDLE_IDENTIFIER: 'NO', SWIFT_VERSION: '6.0', CODE_SIGNING_ALLOWED: 'NO', ENABLE_APP_SANDBOX: 'NO', TARGETED_DEVICE_FAMILY: '2', INFOPLIST_KEY_UILaunchScreen_Generation: 'YES' } }
  } } };
  await writeFile(join(dir, 'project.json'), JSON.stringify(project));
  execFileSync('/opt/homebrew/bin/xcodegen', ['generate', '--spec', join(dir, 'project.json')], { stdio: 'pipe' });
  try {
    const output = execFileSync('/usr/bin/xcodebuild', ['-project', join(dir, 'N01RuntimeCheck.xcodeproj'), '-scheme', 'N01RuntimeCheck', '-configuration', 'Release', '-destination', 'platform=macOS,variant=Mac Catalyst,arch=arm64', '-derivedDataPath', join(dir, 'DerivedData'), 'CODE_SIGNING_ALLOWED=NO', 'build'], { timeout: 240000, maxBuffer: 20 * 1024 * 1024 });
    await writeFile(join(dir, 'build.log'), output);
  } catch (error) { await writeFile(join(dir, 'build.log'), error.stdout ?? ''); throw new Error(`Catalyst build failed: ${dir}/build.log`); }
  const app = join(dir, 'DerivedData/Build/Products/Release-maccatalyst/N01RuntimeCheck.app');
  for (const name of ['good', 'wrongpin', 'denied']) await cp(join(dir, name), join(app, 'Contents/Resources', name), { recursive: true });
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', app], { stdio: 'pipe' });
  await new Promise((done, reject) => {
    const child = spawn('/usr/bin/open', ['-W', '-n', '-g', '-j', '--env', `N01_RUNTIME_DIR=${dir}`, '--stdout', join(dir, 'app-stdout.log'), '--stderr', join(dir, 'app-stderr.log'), app], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', x => output += x); child.stderr.on('data', x => output += x);
    const timer = setTimeout(async () => {
      // Only terminate the PID recorded by this unique runner, after verifying its exact executable.
      try {
        const pid = Number(await readFile(join(dir, 'app.pid'), 'utf8'));
        if (Number.isSafeInteger(pid) && pid > 1) {
          const command = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim();
          if (command === join(app, 'Contents/MacOS/N01RuntimeCheck')) process.kill(pid, 'SIGTERM');
        }
      } catch { /* Already exited or not yet launched; no broad process matching. */ }
      child.kill('SIGTERM');
    }, 40000);
    child.once('error', reject);
    child.once('close', async code => { clearTimeout(timer); await writeFile(join(dir, 'runtime.log'), output); code === 0 ? done() : reject(new Error(`Catalyst runner exit ${code}: ${dir}/runtime.log`)); });
  });
  assert.equal(await readFile(join(dir, 'result.txt'), 'utf8'), 'passed');
  const reports = JSON.parse(await readFile(join(dir, 'reports.json'), 'utf8'));
  assert.deepEqual(Object.keys(reports).sort(), ['denied', 'good', 'wrongpin']);
  assert.equal(counts.http, 3); assert.equal(counts.closedBeforeResponse, 2);
  console.log(JSON.stringify({ status: 'passed', target: 'Mac Catalyst NSH 0.5.0', reports, counts, phoneVerified: false, systemTrustChanged: false }));
} finally {
  if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
  for (const f of ['ca.key', 'server.key', 'ca.pem', 'server.pem', 'server.csr', 'ca.srl', 'ca.der', 'server.der']) await rm(join(dir, f), { force: true });
}
