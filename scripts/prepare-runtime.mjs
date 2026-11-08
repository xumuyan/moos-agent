import { cp, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('M01 currently verifies only darwin-arm64.');
}
const root = resolve('.');
const runtime = join(root, '.generated/runtime');
const binaries = join(root, 'probes/m01/desktop/src-tauri/binaries');
await mkdir(runtime, { recursive: true }); await mkdir(binaries, { recursive: true });
await copyFile(join(root, 'package.json'), join(runtime, 'package.json'));
await copyFile(join(root, 'package-lock.json'), join(runtime, 'package-lock.json'));
execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
  { cwd: runtime, stdio: 'inherit' });
await cp(process.execPath, join(binaries, 'node-aarch64-apple-darwin'));
const nodeLicense = join(dirname(dirname(process.execPath)), 'LICENSE');
await copyFile(nodeLicense, join(runtime, 'NODE-LICENSE'));
execFileSync('xcrun', ['swiftc', '-O', '-target', 'arm64-apple-macosx14.0', join(root, 'probes/m01/native.swift'),
  '-o', join(binaries, 'moos-native-aarch64-apple-darwin')], { stdio: 'inherit' });
await writeFile(join(runtime, 'runtime-manifest.json'), JSON.stringify({
  node: process.version, platform: process.platform, arch: process.arch,
  pi: JSON.parse(await readFile(join(runtime, 'node_modules/@earendil-works/pi-coding-agent/package.json'))).version,
  distribution: 'M01 fully bundled baseline; not final size target',
}, null, 2));
console.log('M01 bundled runtime prepared (no global installations changed).');
