// Explicit isolated Electron acceptance; never targets the installed Moos or user data.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { startFixture } from '../services/agent/fixture.mjs';
import { piModels } from '../apps/electron/plugin/pi-models.js';
import { checkedProvider } from '../packages/pi-adapter/index.mjs';
import { seedHome } from '../apps/electron/profile-home.mjs';

const [inputApp, output, skinFixture] = process.argv.slice(2);
if (!inputApp || !output) throw new Error('Usage: node scripts/verify-electron-recovery.mjs <isolated-build.app> <output-parent> [isolated-skin-home]');
const repo = fileURLToPath(new URL('../', import.meta.url));
const allowedBuild = resolve(repo, '.generated/moos-electron') + sep;
const build = resolve(inputApp);
if (!build.startsWith(allowedBuild) || !(await realpath(build)).startsWith(allowedBuild)) {
  throw new Error('Only repository-isolated build paths are accepted');
}
if (!resolve(output).startsWith(resolve(repo, 'artifacts') + sep)) throw new Error('Output must be inside repository artifacts');
await mkdir(resolve(output), { recursive: true });
const scratch = await mkdtemp(join(resolve(output), 'recovery-'));
const app = join(scratch, 'Moos.app');
execFileSync('/usr/bin/ditto', [build, app]);
const resources = join(app, 'Contents/Resources');
const targetVersion = JSON.parse(await readFile(join(resources, 'profile-template/profiles/web/node_modules/moos-electron-shell/package.json'), 'utf8')).version;
const entry = join(resources, 'app/main.mjs');
// Only visibility is changed in this copied QA bundle. Production lifecycle,
// IPC, renderer, PI and data paths remain the newly built modules.
await writeFile(entry, (await readFile(entry, 'utf8')).replace("app.setName('Moos');", "BrowserWindow.prototype.show = function () {};\napp.setName('Moos');"));
execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'ignore' });
const data = join(scratch, 'data');
const home = join(data, 'dsh');
await seedHome(resources, home);
if (skinFixture) {
  const source = resolve(skinFixture);
  if (!source.startsWith('/private/tmp/moos-') && !source.startsWith(resolve('artifacts') + '/')) throw new Error('Use isolated skin fixtures, never production app data');
  for (const name of ['maid-atelier', 'phoebe-atelier']) await cp(join(source, 'skins', name), join(home, 'skins', name), { recursive: true });
  const plugin = 'profiles/web/node_modules/@linxin666/dsh-client-ui-skin-center';
  await cp(join(source, plugin), join(home, plugin), { recursive: true });
}
const relay = await startFixture({ desktopPolicy: true });
await piModels(data, checkedProvider).save({ id: 'recovery-fixture', name: '隔离恢复验收', model: 'moos-fixture',
  baseUrl: relay.baseUrl, api: 'openai-completions', apiKey: relay.apiKey });
const beforeProviders = await readFile(join(data, 'providers.json'));
const beforeCredentials = await readFile(join(data, 'private/credentials.json'));
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
  child = spawn(join(app, 'Contents/MacOS/Moos'), ['--remote-debugging-port=0'], {
    env: { ...process.env, MOOS_ELECTRON_DATA: data }, stdio: ['ignore', 'ignore', 'pipe'],
  });
  const own = child;
  const closed = new Promise(r => own.once('exit', r));
  let port;
  const lines = createInterface({ input: own.stderr });
  lines.on('line', line => { const match = line.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/); if (match) port = match[1]; });
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
  const rows = () => evaluate(`[...document.querySelectorAll('[data-moos-pi-process]')].map(el => ({
    turn: el.closest('[data-chat-turn]')?.dataset.chatTurn,
    kind: el.closest('[data-chat-flow-kind]')?.dataset.chatFlowKind,
    scrolls: !!el.closest('[data-conversation-scroll]'), summary: el.querySelector('summary').textContent
  }))`);
  async function submit(text) {
    await until(() => evaluate(`(() => { const el = document.querySelector('[data-composer-input]'); el?.focus(); return !!el && document.activeElement === el; })()`), 'composer');
    // Wait for initial session hydration before typing into the editor node.
    await sleep(800);
    await evaluate(`document.querySelector('[data-composer-input]')?.focus()`);
    await call('Input.insertText', { text });
    await until(() => evaluate(`(() => { const field = document.querySelector('[data-composer-input]');
      return field?.textContent.includes(${JSON.stringify(text)}) || field?.value?.includes(${JSON.stringify(text)}); })()`), 'complete task draft');
    await until(() => evaluate(`(() => { const button = document.querySelector('button[aria-label="发送消息"]');
      if (!button || button.disabled) return false; button.click(); return true; })()`), 'enabled send button');
  }
  async function stop() {
    await call('Page.close').catch(() => {});
    await Promise.race([closed, sleep(5000)]);
    if (own.exitCode === null) own.kill('SIGTERM');
    await Promise.race([closed, sleep(5000)]);
    if (own.exitCode === null) { own.kill('SIGKILL'); await closed; throw new Error('GUI did not exit normally'); }
    socket.close(); lines.close();
  }
  async function openSaved() {
    await until(() => evaluate(`(() => {
      const nodes = [...document.querySelectorAll('*')].filter(el => el.textContent === 'MOOS_FIXTURE_WRITE recovery_first');
      const el = nodes.find(el => el.children.length === 0);
      el?.click(); return !!el;
    })()`), 'saved conversation selected');
  }
  return { call, evaluate, rows, submit, stop, openSaved };
}
const report = { source: 'current workspace build', scope: 'isolated copied QA bundle; show() suppressed', checks: {}, notVerified: [] };
try {
  let gui = await launch();
  await gui.submit('MOOS_FIXTURE_WRITE recovery_first');
  await until(() => gui.evaluate(`document.body.innerText.includes('完成 recovery_first')`), 'first reply');
  await gui.submit('MOOS_FIXTURE_WRITE recovery_second');
  await until(() => gui.evaluate(`document.body.innerText.includes('完成 recovery_second')`), 'second reply');
  const before = await until(async () => { const rows = await gui.rows(); return rows.length === 2 && rows.every(row => row.summary.includes('已完成')) && rows; }, 'two finished processes');
  await gui.stop();
  // Seed a genuinely installed older-version fixture with the real package
  // manager, then let the new desktop's startup updater upgrade that profile.
  const stage = join(scratch, 'older-shell');
  await cp(join(resources, 'profile-template/profiles/web/node_modules/moos-electron-shell'), stage, { recursive: true });
  const manifest = JSON.parse(await readFile(join(stage, 'package.json'), 'utf8'));
  manifest.version = '0.1.25';
  await writeFile(join(stage, 'package.json'), JSON.stringify(manifest));
  const archive = execFileSync('npm', ['pack', stage, '--pack-destination', scratch, '--silent'], { encoding: 'utf8' }).trim();
  const cli = join(resources, 'host-runtime/bin/dsh');
  execFileSync(cli, ['plugin', '--profile', 'web', 'add', join(scratch, archive), '--save-exact'], {
    env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' }, stdio: 'pipe', timeout: 30000,
  });
  assert.equal(JSON.parse(await readFile(join(home, 'profiles/web/node_modules/moos-electron-shell/package.json'), 'utf8')).version, '0.1.25');
  gui = await launch();
  await gui.openSaved();
  assert.equal(JSON.parse(await readFile(join(home, 'profiles/web/node_modules/moos-electron-shell/package.json'), 'utf8')).version, targetVersion);
  report.checks.realStartupUpgradesOlderFixtureAndRetainsTwoTurns = true;
  const restored = await until(async () => { const rows = await gui.rows(); return rows.length === 2 && rows; }, 'history after normal restart');
  assert.deepEqual(restored, before);
  assert.ok(await gui.evaluate(`document.body.innerText.includes('完成 recovery_first') && document.body.innerText.includes('完成 recovery_second')`));
  assert.ok(restored.every(row => row.kind === 'turn-process' && row.scrolls && row.turn));
  assert.deepEqual(await readFile(join(data, 'providers.json')), beforeProviders);
  assert.deepEqual(await readFile(join(data, 'private/credentials.json')), beforeCredentials);
  report.checks.restartTwoTurnsAndProcessOwnership = true;
  report.checks.modelAndCredentialBytesPreserved = true;
  await writeFile(join(scratch, 'restart.png'), Buffer.from((await gui.call('Page.captureScreenshot')).data, 'base64'));
  const controls = await gui.evaluate(`[...document.querySelectorAll('button')].map(el=>({label:el.getAttribute('aria-label'),title:el.title,text:el.innerText})).filter(x=>/分支|branch|fork/i.test(JSON.stringify(x)))`);
  report.branchControls = controls;
  function taskCount() {
    const db = new DatabaseSync(join(data, 'pi/moos.sqlite'), { readOnly: true });
    try { return db.prepare('SELECT count(*) AS count FROM tasks').get().count; }
    finally { db.close(); }
  }
  const tasksBeforeBranch = taskCount();
  assert.equal(controls.length, 2);
  await gui.evaluate(`document.querySelector('button[aria-label="在新对话中分支"]').click()`);
  await until(() => gui.evaluate(`document.body.innerText.includes('完成 recovery_first') && !document.body.innerText.includes('完成 recovery_second')`), 'selected fork history excludes later parent turn');
  report.checks.branchSelectedTextHistory = true;
  const inheritedRows = await until(async () => { const rows = await gui.rows(); return rows.length === 1 && rows; }, 'exactly the selected inherited PI process');
  assert.deepEqual(inheritedRows, before.slice(0, 1));
  report.checks.branchInheritedProcessVisible = true;
  assert.equal(taskCount(), tasksBeforeBranch, 'opening a fork must not replay parent tasks');
  report.checks.branchDoesNotReplayTasks = true;
  await writeFile(join(scratch, 'branch.png'), Buffer.from((await gui.call('Page.captureScreenshot')).data, 'base64'));
  await gui.call('Page.reload');
  const reloadedBranch = await until(async () => { const rows = await gui.rows(); return rows.length === 1 && rows; }, 'fork process after page reload');
  assert.deepEqual(reloadedBranch, inheritedRows);
  report.checks.branchProcessSurvivesPageReload = true;
  await gui.stop();
  for (const skin of skinFixture ? ['maid-atelier', 'phoebe-atelier'] : []) {
    await writeFile(join(home, 'skin-center-active.json'), JSON.stringify({ active: skin, initialized: true }));
    gui = await launch();
    await until(() => gui.evaluate(`document.documentElement.dataset.dshSkin === ${JSON.stringify(skin)}`), skin + ' active');
    await gui.openSaved();
    const skinned = await until(async () => { const rows = await gui.rows(); return rows.length === 2 && rows; }, skin + ' history');
    assert.deepEqual(skinned, before);
    report.checks[skin + 'RestoresTurnProcesses'] = true;
    await writeFile(join(scratch, skin + '.png'), Buffer.from((await gui.call('Page.captureScreenshot')).data, 'base64'));
    await gui.stop();
  }
  report.notVerified.push('Formal installation and production user data were not touched.',
    ...(!report.checks.branchInheritedProcessVisible ? ['Inherited PI process cards are missing in the fork; not accepted as complete.'] : []));
  await writeFile(join(scratch, 'report.json'), JSON.stringify(report, null, 2));
  console.log('PASS isolated restart, data preservation and requested skin samples: ' + scratch);
} finally {
  for (const socket of sockets) socket.close();
  if (child?.exitCode === null) { const closed = new Promise(r => child.once('exit', r)); child.kill('SIGTERM'); await Promise.race([closed, sleep(5000)]); if (child.exitCode === null) { child.kill('SIGKILL'); await closed; } }
  await relay.close();
}
