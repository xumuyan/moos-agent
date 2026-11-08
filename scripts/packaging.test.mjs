import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, cp, rm, access, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'moos-packaging-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
async function executable(path, source) {
  await writeFile(path, `#!${process.execPath}\n${source}`, { mode: 0o755 });
}

test('runtime preparation supplies executable Node only to the independent Tauri probe', {
  skip: process.platform !== 'darwin' || process.arch !== 'arm64',
}, async t => {
  const directory = await fixture(t);
  const bin = join(directory, 'bin');
  await mkdir(bin);
  await writeFile(join(directory, 'package.json'), '{}');
  await writeFile(join(directory, 'package-lock.json'), '{}');
  // Isolate dependency installation and Swift compilation, not Node copying.
  await executable(join(bin, 'npm'), `const fs = require('node:fs');
fs.mkdirSync('node_modules/@earendil-works/pi-coding-agent', { recursive: true });
fs.writeFileSync('node_modules/@earendil-works/pi-coding-agent/package.json', '{"version":"1.5.0"}');`);
  await executable(join(bin, 'xcrun'), `process.exit(0);`);
  execFileSync(process.execPath, [join(root, 'scripts/prepare-runtime.mjs')], {
    cwd: directory, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  const node = join(directory, 'probes/m01/desktop/src-tauri/binaries/node-aarch64-apple-darwin');
  assert.equal(execFileSync(node, ['--version'], { encoding: 'utf8' }).trim(), process.version);
  assert.deepEqual(await readFile(node), await readFile(process.execPath));
  await assert.rejects(stat(join(directory, 'apps')), { code: 'ENOENT' });
});

test('build:app delegates to the Electron package from the repository root', async t => {
  const directory = await fixture(t);
  const desktop = join(directory, 'apps/electron');
  await mkdir(desktop, { recursive: true });
  await cp(join(root, 'package.json'), join(directory, 'package.json'));
  await cp(join(root, 'apps/electron/package.json'), join(desktop, 'package.json'));
  await writeFile(join(desktop, 'prepare-local.mjs'),
    "import { writeFileSync } from 'node:fs'; writeFileSync('bundle-ready', '');");
  execFileSync('npm', ['run', 'build:app'], { cwd: directory, stdio: 'pipe' });
  await access(join(desktop, 'bundle-ready'));
});
