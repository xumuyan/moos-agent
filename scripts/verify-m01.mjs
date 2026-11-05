import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir, lstat, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { cleanupOwnedProcesses, waitForChildExit, waitForExitedPids } from './owned-processes.mjs';

const app = resolve('probes/m01/desktop/src-tauri/target/release/bundle/macos/Moos M01 Probe.app');
const artifacts = resolve('artifacts/m01');
await mkdir(artifacts, { recursive: true });
const output = join(artifacts, 'packaged-probe.json');
const child = spawnSync(join(app, 'Contents/MacOS/moos-m01-probe'), [`--probe-output=${output}`], {
  cwd: '/tmp', env: { PATH: '/usr/bin:/bin', TMPDIR: process.env.TMPDIR },
  timeout: 60000, encoding: 'utf8',
});
assert.equal(child.status, 0, child.stderr || String(child.error));
const result = JSON.parse(await readFile(output, 'utf8'));
assert.equal(result.packagedRuntime, true);
assert.equal(result.pi.status, 'passed');
assert.equal(result.pi.realProviderVerified, false);
const holdFile = join(artifacts, 'gui-exit-hold.json');
const exitOutput = join(artifacts, 'gui-exit-probe.json');
await Promise.all([rm(holdFile, { force: true }), rm(exitOutput, { force: true })]);
const exited = spawnSync(join(app, 'Contents/MacOS/moos-m01-probe'), [
  `--probe-output=${exitOutput}`, `--probe-hold-file=${holdFile}`, '--probe-exit-after-hold',
], { cwd: '/tmp', env: { PATH: '/usr/bin:/bin', TMPDIR: process.env.TMPDIR }, timeout: 60000, encoding: 'utf8' });
assert.equal(exited.status, 0, exited.stderr || String(exited.error));
const held = JSON.parse(await readFile(holdFile, 'utf8'));
assert(held.hostPid > 0 && held.piPid > 0);
for (const pid of [held.hostPid, held.piPid]) {
  assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH', `process ${pid} must exit with the GUI`);
}
const delay = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
async function verifyGuiCrash(binary) {
  const holdFile = join(artifacts, 'gui-crash-hold.json');
  const crashOutput = join(artifacts, 'gui-crash-probe.json');
  await Promise.all([rm(holdFile, { force: true }), rm(crashOutput, { force: true })]);
  const child = spawn(binary, [`--probe-output=${crashOutput}`, `--probe-hold-file=${holdFile}`], {
    cwd: '/tmp', env: { PATH: '/usr/bin:/bin', TMPDIR: process.env.TMPDIR }, stdio: ['ignore', 'ignore', 'pipe'],
  });
  const exited = once(child, 'exit');
  let stderr = '';
  let crashHeld;
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  let result;
  let failure;
  try {
    for (let attempt = 0; attempt < 600 && !crashHeld; attempt++) {
      try { crashHeld = JSON.parse(await readFile(holdFile, 'utf8')); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (child.exitCode !== null || child.signalCode !== null) break;
        await delay(25);
      }
    }
    assert(crashHeld, `packaged GUI did not reach active PI hold: ${stderr}`);
    assert(crashHeld.hostPid > 0 && crashHeld.piPid > 0);
    assert.equal(child.kill('SIGKILL'), true);
    assert.equal(await waitForChildExit(exited), true, 'packaged app must exit after SIGKILL');
    const [, signal] = await exited;
    assert.equal(signal, 'SIGKILL');
    const remaining = await waitForExitedPids([crashHeld.hostPid, crashHeld.piPid]);
    assert.equal(remaining.size, 0, 'Node host and PI child must exit after the packaged GUI is killed');
    result = { status: 'passed', exitMode: 'SIGKILL to packaged GUI while PI was active',
      appProcessExited: true, hostProcessExited: true, piProcessExited: true };
  } catch (error) {
    failure = error;
  }
  const cleanupErrors = await cleanupOwnedProcesses(child, exited,
    crashHeld ? [crashHeld.hostPid, crashHeld.piPid] : []);
  if (failure && cleanupErrors.length) {
    throw new AggregateError([failure, ...cleanupErrors], 'GUI crash verification and cleanup failed');
  }
  if (failure) throw failure;
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'GUI crash cleanup failed');
  return result;
}
const guiCrash = await verifyGuiCrash(join(app, 'Contents/MacOS/moos-m01-probe'));
async function bytes(path) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) return 0;
  if (!stat.isDirectory()) return stat.size;
  const sizes = await Promise.all((await readdir(path)).map(name => bytes(join(path, name))));
  return sizes.reduce((sum, size) => sum + size, 0);
}
const nativeBinary = join(app, 'Contents/MacOS/moos-native');
let desktop = { status: 'not-run', reason: 'pass --desktop-input for an explicit own-window test' };
if (process.argv.includes('--desktop-input')) {
  const screenshot = join(artifacts, 'packaged-native-window.png');
  const native = spawnSync(nativeBinary, ['self-test', screenshot], { timeout: 20000, encoding: 'utf8' });
  if (native.status === 3) desktop = JSON.parse(native.stdout);
  else {
    assert.equal(native.status, 0, native.stderr || native.stdout || String(native.error));
    desktop = JSON.parse(native.stdout);
    assert.equal(desktop.clickVerified, true);
    assert.equal(desktop.inputVerified, true);
    desktop.screenshotSha256 = createHash('sha256').update(await readFile(screenshot)).digest('hex');
  }
}
const archive = join(artifacts, 'Moos-M01-arm64.zip');
execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, archive]);
const report = {
  recordedAt: new Date().toISOString(),
  host: { arch: process.arch, macOS: execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim() },
  packagedResult: result, desktop, guiCrash,
  guiExit: { status: 'passed', exitMode: 'normal Tauri exit while PI was active',
    hostProcessExited: true, piProcessExited: true },
  sizes: { appLogicalBytes: await bytes(app),
    appAllocatedBytes: Number(execFileSync('/usr/bin/du', ['-sk', app], { encoding: 'utf8' }).split('\t')[0]) * 1024,
    archiveBytes: (await lstat(archive)).size,
    nodeBytes: (await lstat(join(app, 'Contents/MacOS/node'))).size,
    dependenciesLogicalBytes: await bytes(join(app, 'Contents/Resources/runtime/node_modules')) },
  archiveSha256: createHash('sha256').update(await readFile(archive)).digest('hex'),
  limitations: ['local model fixture only', 'iPhone not verified', 'ad-hoc development build, not notarized',
    'no minimum macOS version or Retina input validation', 'full-runtime baseline, not final package size'],
};
await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
