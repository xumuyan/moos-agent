// Isolated MuMa (沐码) brand, unchanged bundle identity and PI smoke acceptance.
// Never launches or alters the installed app or production user data.
// Verifies: a task whose bash writes 12 files renders the turn-tail workspace-change
// list as a COLLAPSED <details data-moos-turn-files> (summary heading kept, starts
// closed), and clicking the summary expands the full 12-item list. Screenshots of
// both states are saved next to the report.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, writeFile, appendFile, readdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createInterface } from 'node:readline';
import { startFixture } from '../services/agent/fixture.mjs';
import { checkedProvider } from '../packages/pi-adapter/index.mjs';
import { piModels } from '../apps/electron/plugin/pi-models.js';
import { seedHome } from '../apps/electron/profile-home.mjs';
import { fileURLToPath } from 'node:url';

const [inputApp, output] = process.argv.slice(2);
if (!inputApp || !output) throw new Error('Usage: node scripts/verify-electron-brand.mjs <isolated-build.app> <output-parent>');
const repo = fileURLToPath(new URL('../', import.meta.url));
const allowedBuild = resolve(repo, '.generated/moos-electron') + sep;
const build = resolve(inputApp);
if (!build.startsWith(allowedBuild) || !(await realpath(build)).startsWith(allowedBuild)) {
  throw new Error('Only repository-isolated build paths are accepted');
}
if (!resolve(output).startsWith(resolve(repo, 'artifacts') + sep)) throw new Error('Output must be inside repository artifacts');
await mkdir(resolve(output), { recursive: true });
const scratch = await mkdtemp(join(resolve(output), 'recovery-'));
const app = join(scratch, 'MuMa.app');
execFileSync('/usr/bin/ditto', [build, app]);
const resources = join(app, 'Contents/Resources');
const plist = key => execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print ' + key, join(app, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
const identity = { name: plist('CFBundleName'), displayName: plist('CFBundleDisplayName'),
  executable: plist('CFBundleExecutable'), bundleId: plist('CFBundleIdentifier'), version: plist('CFBundleShortVersionString') };
assert.equal(identity.name, 'MuMa');
assert.equal(identity.displayName, 'MuMa');
assert.equal(identity.executable, 'MuMa');
assert.equal(identity.bundleId, 'dev.moos.agent.electron');
for (const [locale, expected] of [['en', 'MuMa'], ['zh-Hans', '沐码'], ['zh-Hant', '沐碼']]) {
  assert.equal(await readFile(join(resources, locale + '.lproj/InfoPlist.strings'), 'utf8'), `"CFBundleDisplayName" = "${expected}";\n`);
}
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'ignore' });
const iconBytes = await readFile(join(resources, 'moos.icns'));
assert.ok(iconBytes.equals(await readFile(join(repo, 'apps/electron/assets/moos.icns'))), 'packaged ICNS matches approved source');
const iconHash = createHash('sha256').update(iconBytes).digest('hex');
const shellVersion = JSON.parse(await readFile(join(resources, 'profile-template/profiles/web/node_modules/moos-electron-shell/package.json'), 'utf8')).version;
const hasCollapse = (await readFile(join(resources, 'profile-template/profiles/web/node_modules/moos-electron-shell/client.js'), 'utf8')).includes('data-moos-turn-files');
if (!hasCollapse) throw new Error('Isolated build lacks the turn-tail collapse change');
const entry = join(resources, 'app/main.mjs');
assert.ok((await readFile(entry, 'utf8')).includes("app.setName('MuMa');"));
await writeFile(entry, (await readFile(entry, 'utf8')).replace("app.setName('MuMa');", "BrowserWindow.prototype.show = function () {};\nprocess.on('SIGUSR2', () => app.quit());\napp.setName('MuMa');"));
execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'ignore' });
const data = join(scratch, 'data');
const home = join(data, 'dsh');
await seedHome(resources, home);
const relay = await startFixture({ desktopPolicy: true });
await piModels(data, checkedProvider).save({ id: 'many-fixture', name: '折叠隔离验收', model: 'moos-fixture',
  baseUrl: relay.baseUrl, service: 'openai', api: 'openai-completions', apiKey: relay.apiKey });
let child;
const sockets = [];
async function until(fn, label) {
  for (let i = 0; i < 160; i++) {
    const result = await fn().catch(() => null);
    if (result) return result;
    if (child?.exitCode !== null) break;
    await sleep(250);
  }
  throw new Error('Did not observe ' + label);
}
async function launch() {
  // Host passthrough (danger mode) leaks ELECTRON_RUN_AS_NODE and MOOS_ELECTRON_*/DSH_* into this
  // process; the isolated instance must start as a real GUI app, so strip them like the installer does.
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name === 'ELECTRON_RUN_AS_NODE' || name.startsWith('MOOS_ELECTRON_') || name.startsWith('DSH_')) delete env[name];
  }
  env.TMPDIR = '/private/tmp/';
  env.MOOS_ELECTRON_DATA = data;
  child = spawn(join(app, 'Contents/MacOS/MuMa'), ['--remote-debugging-port=0'], {
    env, stdio: ['ignore', 'ignore', 'pipe'],
  });
  const own = child;
  const closed = new Promise(r => own.once('exit', r));
  let port;
  const lines = createInterface({ input: own.stderr });
  lines.on('line', line => {
    void appendFile(join(scratch, 'app-stderr.log'), line + '\n').catch(() => {});
    const match = line.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/);
    if (match) port = match[1];
  });
  await until(async () => port, 'isolated debug port');
  const target = await until(async () => (await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json()))
    .find(row => row.url.startsWith('http://127.0.0.1:')), 'workbench');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  sockets.push(socket);
  await new Promise((r, j) => { socket.addEventListener('open', r, { once: true }); socket.addEventListener('error', j, { once: true }); });
  let seq = 0;
  const pending = new Map();
  socket.addEventListener('message', event => { const response = JSON.parse(event.data); pending.get(response.id)?.(response); });
  function call(method, params = {}) {
    return new Promise((r, j) => {
      const id = ++seq;
      const timer = setTimeout(() => { pending.delete(id); j(new Error('CDP request timeout')); }, 15000);
      pending.set(id, response => { clearTimeout(timer); pending.delete(id); response.error ? j(new Error(response.error.message)) : r(response.result); });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error('Isolated page evaluation failed');
    return result.result.value;
  }
  const capture = async name => writeFile(join(scratch, name + '.png'),
    Buffer.from((await call('Page.captureScreenshot')).data, 'base64'));
  async function submit(text) {
    // First-run hero shows an inert workspace trigger instead of the composer; clicking it
    // enters the default workspace and mounts the real Lexical contenteditable in place.
    await until(() => evaluate(`(() => {
      const dec = document.querySelector('[data-composer-input]');
      if (!dec) return null;
      if (dec.getAttribute('data-phase') === 'inert') { dec.click(); return null; }
      return dec.getAttribute('contenteditable') === 'true';
    })()`), 'composer active');
    await call('Input.insertText', { text });
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  }
  return { call, evaluate, capture, submit, stop: async () => {
    // QA-only entry triggers the real app.quit/before-quit Host cleanup path.
    // CDP Page.close closes a target, but did not reliably quit this hidden macOS app.
    own.kill('SIGUSR2');
    await Promise.race([closed, sleep(15000)]);
    const usedTerm = own.exitCode === null;
    if (usedTerm) own.kill('SIGTERM');
    await Promise.race([closed, sleep(15000)]);
    if (own.exitCode === null) { own.kill('SIGKILL'); await closed; throw new Error('GUI did not exit normally'); }
    socket.close(); lines.close();
    assert.equal(usedTerm, false, 'app.quit must allow a graceful app/Host exit');
    assert.equal(own.exitCode, 0, 'isolated GUI exits normally');
    return { code: own.exitCode, signal: own.signalCode, usedTerm, method: 'QA SIGUSR2 → app.quit' };
  } };
}

let gui;
try {
  gui = await launch();
  const branding = await until(() => gui.evaluate(`(() => {
    const name = document.querySelector('[data-moos-sidebar-name]');
    const icon = document.querySelector('[data-moos-sidebar-icon]');
    return name && icon?.complete && icon.naturalWidth > 0 && { name: name.textContent, chinese: name.title, title: document.title, icon: icon.src, iconWidth: icon.naturalWidth };
  })()`), 'MuMa sidebar');
  assert.equal(branding.name, 'MuMa');
  assert.equal(branding.chinese, '沐码');
  assert.ok(branding.title.includes('MuMa · 沐码'));
  assert.equal(shellVersion, identity.version);
  assert.equal(branding.icon, 'data:image/png;base64,' + (await readFile(join(repo, 'apps/electron/assets/sidebar-icon.png'))).toString('base64'));
  assert.equal(branding.iconWidth, 32);
  delete branding.icon;
  branding.icnsSha256 = iconHash;
  // workspace-changes diffs git snapshots; seed the isolated workspace as a git repo so
  // files written by the fixture bash show up as new files in the turn tail.
  const workspaceRoot = join(data, 'workspace');
  await mkdir(workspaceRoot, { recursive: true });
  const entries = (await readdir(workspaceRoot)).filter(name => !name.startsWith('.'));
  const workspace = join(workspaceRoot, entries[0] ?? 'deepseek-harness', 'default-workspace');
  await mkdir(workspace, { recursive: true });
  execFileSync('/usr/bin/git', ['init', '-q'], { cwd: workspace });
  execFileSync('/usr/bin/git', ['add', '-A'], { cwd: workspace });
  await until(() => gui.evaluate(`!!document.querySelector('[data-composer-input]')`), 'composer ready');
  await gui.submit('MOOS_FIXTURE_MANY');
  await until(() => gui.evaluate(`document.body.innerText.includes('完成 MANY 12')`), 'MANY reply rendered');
  const collapsed = await until(() => gui.evaluate(`(() => {
    const details = document.querySelector('[data-moos-turn-files]');
    if (!details) return null;
    const summary = details.querySelector('summary');
    return {
      present: true,
      open: details.open,
      summaryText: (summary?.textContent ?? '').trim(),
      heading: (summary?.childNodes[0]?.textContent ?? '').trim(),
      hint: summary?.querySelector('small')?.textContent ?? '',
    };
  })()`), 'collapsed turn tail');
  await sleep(800); // let hydration settle before screenshots
  assert.equal(collapsed.open, false, 'details must start collapsed');
  assert.ok(/工作区变化\s*·\s*12\s*个文件/.test(collapsed.summaryText), `summary must keep the count (${collapsed.summaryText})`);
  assert.ok(collapsed.hint.includes('已折叠'), `summary hint must say collapsed (${collapsed.hint})`);
  await gui.capture('many-collapsed');
  await gui.evaluate(`document.querySelector('[data-moos-turn-files] summary').click()`);
  const expanded = await until(() => gui.evaluate(`(() => {
    const details = document.querySelector('[data-moos-turn-files]');
    if (!details?.open) return null;
    const items = details.querySelectorAll('ul > li');
    const paths = [...items].map(item => item.querySelector('span')?.textContent ?? '');
    return { open: details.open, count: items.length, paths,
      allNamed: paths.filter(path => /^many-\\d+\\.txt$/.test(path)).length,
      first: paths[0], last: paths[paths.length - 1],
      height: Math.round(details.getBoundingClientRect().height) };
  })()`), 'expanded turn tail');
  assert.equal(expanded.open, true);
  assert.equal(expanded.count, 12, `expanding must reveal all 12 files (${expanded.count})`);
  assert.equal(expanded.allNamed, 12, 'every listed file must be a many-N.txt');
  const expected = Array.from({ length: 12 }, (_, i) => `many-${i + 1}.txt`);
  assert.deepEqual([...expanded.paths].sort(), [...expected].sort(), 'expanding must list all twelve fixture files');
  await gui.capture('many-expanded');
  await gui.evaluate(`document.querySelector('[data-moos-turn-files] summary').click()`);
  const recollapsed = await gui.evaluate(`document.querySelector('[data-moos-turn-files]').open`);
  assert.equal(recollapsed, false, 'clicking the summary again must collapse');
  const exit = await gui.stop();
  await relay.close();
  await writeFile(join(scratch, 'brand-report.json'), JSON.stringify({
    time: new Date().toISOString(), identity, branding,
    shell: shellVersion, collapsed, expanded, recollapsed, exit,
  }, null, 2));
  console.log('MuMa branding + turn-tail collapse isolated GUI acceptance OK:', JSON.stringify({
    shell: shellVersion, name: branding.name, title: branding.title, expandedCount: expanded.count, exit }));
} catch (error) {
  try {
    const state = await gui.evaluate(`(() => ({ text: document.body.innerText.slice(0, 300),
      composer: !!document.querySelector('[data-composer-input]'),
      value: document.querySelector('[data-composer-input]')?.value ?? '',
      tail: !!document.querySelector('[data-moos-pi-turn]') }))()`);
    await gui.capture('debug-state');
    console.error('DIAGNOSTIC_STATE ' + JSON.stringify(state));
  } catch {}
  throw error;
} finally {
  for (const socket of sockets.splice(0)) { try { socket.close(); } catch {} }
  if (child?.exitCode === null) { child.kill('SIGKILL'); await sleep(1000); }
  await relay.close();
}
