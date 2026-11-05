import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, cp, rm, access } from 'node:fs/promises';
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

test('runtime preparation supplies executable Node to both clean Tauri projects', {
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
  for (const project of ['probes/m01/desktop', 'apps/desktop']) {
    const node = join(directory, project, 'src-tauri/binaries/node-aarch64-apple-darwin');
    assert.equal(execFileSync(node, ['--version'], { encoding: 'utf8' }).trim(), process.version);
    assert.deepEqual(await readFile(node), await readFile(process.execPath));
  }
});

test('dev:app invokes the root Tauri CLI from the desktop directory without a desktop tauri script', async t => {
  const directory = await fixture(t);
  await cp(join(root, 'package.json'), join(directory, 'package.json'));
  await mkdir(join(directory, 'apps/desktop'), { recursive: true });
  await cp(join(root, 'apps/desktop/package.json'), join(directory, 'apps/desktop/package.json'));
  await mkdir(join(directory, 'node_modules/.bin'), { recursive: true });
  await executable(join(directory, 'node_modules/.bin/tauri'), `const fs = require('node:fs');
const assert = require('node:assert/strict');
assert.deepEqual(process.argv.slice(2), ['dev']);
assert.equal(require('node:path').basename(process.cwd()), 'desktop');
assert.equal(JSON.parse(fs.readFileSync('package.json')).name, '@moos/desktop');
fs.writeFileSync('../../dev-ready', '');`);
  execFileSync('npm', ['run', 'dev:app'], { cwd: directory, stdio: 'pipe' });
  await access(join(directory, 'dev-ready'));
});

test('Tauri dev hook starts Vite once from the desktop directory', async t => {
  const directory = await fixture(t);
  const desktop = join(directory, 'apps/desktop');
  await mkdir(join(desktop, 'src-tauri'), { recursive: true });
  await cp(join(root, 'apps/desktop/package.json'), join(desktop, 'package.json'));
  await cp(join(root, 'apps/desktop/src-tauri/tauri.conf.json'), join(desktop, 'src-tauri/tauri.conf.json'));
  await mkdir(join(desktop, 'node_modules/.bin'), { recursive: true });
  await executable(join(desktop, 'node_modules/.bin/vite'), `const fs = require('node:fs');
const assert = require('node:assert/strict');
assert.deepEqual(process.argv.slice(2), ['--host', '127.0.0.1', '--port', '1420']);
assert.equal(JSON.parse(fs.readFileSync('package.json')).name, '@moos/desktop');
fs.writeFileSync('vite-ready', '', { flag: 'wx' });`);
  const config = JSON.parse(await readFile(join(desktop, 'src-tauri/tauri.conf.json'), 'utf8'));
  const hook = config.build.beforeDevCommand;
  assert.ok(hook, 'Tauri must start Vite before waiting for devUrl');
  const script = typeof hook === 'string' ? hook : hook.script;
  // Verified with the installed Tauri CLI: the default hook cwd is apps/desktop,
  // not src-tauri or the repository root.
  const cwd = typeof hook === 'object' && hook.cwd ? join(desktop, hook.cwd) : desktop;
  execFileSync(script, { cwd, shell: true, stdio: 'pipe' });
  await access(join(desktop, 'vite-ready'));
});

test('build:app prepares runtime and frontend before invoking the root Tauri CLI', async t => {
  const directory = await fixture(t);
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  manifest.scripts['prepare:runtime'] = `node -e "require('fs').writeFileSync('runtime-ready', '')"`;
  manifest.scripts['build:desktop'] = `node -e "require('fs').accessSync('runtime-ready'); require('fs').mkdirSync('apps/desktop/dist', {recursive:true}); require('fs').writeFileSync('apps/desktop/dist/index.html', 'built')"`;
  await writeFile(join(directory, 'package.json'), JSON.stringify(manifest));
  await mkdir(join(directory, 'apps/desktop'), { recursive: true });
  await cp(join(root, 'apps/desktop/package.json'), join(directory, 'apps/desktop/package.json'));
  await mkdir(join(directory, 'node_modules/.bin'), { recursive: true });
  await executable(join(directory, 'node_modules/.bin/tauri'), `const fs = require('node:fs');
const assert = require('node:assert/strict');
assert.deepEqual(process.argv.slice(2), ['build', '--bundles', 'app']);
assert.equal(fs.readFileSync('dist/index.html', 'utf8'), 'built');
fs.accessSync('../../runtime-ready');
fs.writeFileSync('../../bundle-ready', '');`);
  execFileSync('npm', ['run', 'build:app'], { cwd: directory, stdio: 'pipe' });
  await access(join(directory, 'bundle-ready'));
});
