// Explicit isolated Electron acceptance; never targets the installed Moos or user data.
// Verifies P03.13 会话恢复子项 remaining gaps (E124):
//  1. A forked conversation keeps showing inherited PI process cards after a FULL
//     application restart (E83 only covered page reload), with no task replay.
//  2. Turning off the machine is not simulated here; the >1600-event inherited window
//     behaviour is covered by unit tests in apps/electron/fork-process.test.mjs.
// Flow: two fixture WRITE turns -> branch from turn 1 -> verify branch view -> quit ->
// relaunch on the same data dir -> reopen the branch conversation -> verify again ->
// quit -> SQLite checks prove no tasks/events were added by reopening.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, writeFile, appendFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { startFixture } from 'file:///Users/xuguopeng/Documents/%E5%BE%90%E9%83%AD%E9%B9%8F%E9%A1%B9%E7%9B%AE/%E5%BE%90-moos-agent/services/agent/fixture.mjs';
import { checkedProvider } from 'file:///Users/xuguopeng/Documents/%E5%BE%90%E9%83%AD%E9%B9%8F%E9%A1%B9%E7%9B%AE/%E5%BE%90-moos-agent/packages/pi-adapter/index.mjs';
import { piModels } from 'file:///Users/xuguopeng/Documents/%E5%BE%90%E9%83%AD%E9%B9%8F%E9%A1%B9%E7%9B%AE/%E5%BE%90-moos-agent/apps/electron/plugin/pi-models.js';
import { seedHome } from 'file:///Users/xuguopeng/Documents/%E5%BE%90%E9%83%AD%E9%B9%8F%E9%A1%B9%E7%9B%AE/%E5%BE%90-moos-agent/apps/electron/profile-home.mjs';

const [inputApp, output] = process.argv.slice(2);
if (!inputApp || !output) throw new Error('Usage: node gui.mjs <isolated-build.app> <output-parent>');
const repo = '/Users/xuguopeng/Documents/徐郭鹏项目/徐-moos-agent';
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
const shellVersion = JSON.parse(await readFile(join(resources, 'profile-template/profiles/web/node_modules/moos-electron-shell/package.json'), 'utf8')).version;
const clientSource = await readFile(join(resources, 'profile-template/profiles/web/node_modules/moos-electron-shell/client.js'), 'utf8');
if (!clientSource.includes('data-moos-pi-process')) throw new Error('Isolated build lacks the PI process read model');
const entry = join(resources, 'app/main.mjs');
await writeFile(entry, (await readFile(entry, 'utf8')).replace("app.setName('沐码');", "BrowserWindow.prototype.show = function () {};\napp.setName('沐码');"));
execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'ignore' });
const data = join(scratch, 'data');
const home = join(data, 'dsh');
await seedHome(resources, home);
const relay = await startFixture({ desktopPolicy: true });
await piModels(data, checkedProvider).save({ id: 'fork-fixture', name: '分支恢复隔离验收', model: 'moos-fixture',
  baseUrl: relay.baseUrl, service: 'openai', api: 'openai-completions', apiKey: relay.apiKey });

const sockets = [];
let child;
async function until(fn, label) {
  for (let i = 0; i < 240; i++) {
    const result = await fn().catch(() => null);
    if (result) return result;
    if (child?.exitCode !== null) break;
    await sleep(250);
  }
  throw new Error('Did not observe ' + label);
}
async function untilWhere(fn, predicate, label) {
  return until(async () => {
    const value = await fn();
    return value && predicate(value) ? value : null;
  }, label);
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
  const logStream = createInterface({ input: child.stderr });
  logStream.on('line', line => { void appendFile(join(scratch, 'app-stderr.log'), line + '\n').catch(() => {}); });
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
  const sessionState = () => evaluate(`(() => {
    const text = document.body.innerText;
    return {
      session: document.querySelector('[data-conversation-session]')?.getAttribute('data-conversation-session') ?? null,
      summary: document.querySelector('[data-moos-pi-process] summary')?.textContent ?? null,
      hasAlpha: text.includes('完成 alpha'), hasBeta: text.includes('完成 beta'),
      branchButtons: [...document.querySelectorAll('button[aria-label="在新对话中分支"]')]
        .filter(el => !el.hasAttribute('data-unavailable') && el.getAttribute('aria-disabled') !== 'true').length,
    };
  })()`);
  // Diagnostic dump: clickable conversation candidates for the sidebar reselect step.
  const sidebarDump = () => evaluate(`(() => {
    const rows = [];
    for (const el of document.querySelectorAll('a, button, [role="button"], li, [tabindex]')) {
      const text = (el.textContent || '').trim().replace(/\\s+/g, ' ');
      if (!text || text.length > 120) continue;
      const rect = el.getBoundingClientRect();
      if (rect.left > window.innerWidth * 0.45) continue;
      rows.push({ tag: el.tagName, text: text.slice(0, 100), aria: el.getAttribute('aria-label'),
        cls: String(el.className || '').slice(0, 70) });
    }
    return rows;
  })()`);
  const dump = async name => { try { await writeFile(join(scratch, name + '.json'), JSON.stringify(await sidebarDump(), null, 1) + '\n'); } catch {} };
  return { call, evaluate, capture, submit, sessionState, dump,
    stop: async () => {
      await call('Page.close').catch(() => {});
      let method = 'Page.close';
      await Promise.race([closed, sleep(5000)]);
      if (own.exitCode === null) { own.kill('SIGTERM'); method = 'Page.close → SIGTERM'; }
      await Promise.race([closed, sleep(5000)]);
      if (own.exitCode === null) { own.kill('SIGKILL'); await closed; throw new Error('GUI did not exit normally'); }
      const result = { code: own.exitCode, signal: own.signalCode, method };
      socket.close(); lines.close();
      return result;
    } };
}

function readDb() {
  const db = new DatabaseSync(join(data, 'pi/moos.sqlite'), { readOnly: true });
  try {
    return {
      tasks: db.prepare('select conversationId, status from tasks').all(),
      events: db.prepare('select count(*) c from events').get().c,
      sessionA: db.prepare('select value from settings where key = ?').get('dsh-session:' + globalThis.sessionA)?.value ?? null,
      sessionB: db.prepare('select value from settings where key = ?').get('dsh-session:' + globalThis.sessionB)?.value ?? null,
      inheritedKeys: db.prepare("select key from settings where key like 'dsh-inherited-turn:%'").all().map(row => row.key),
      conversationIds: db.prepare('select id from conversations').all().map(row => row.id),
    };
  } finally { db.close(); }
}

try {
  // Phase 1: two completed turns, then branch from the first turn.
  const gui = await launch();
  await gui.submit('MOOS_FIXTURE_WRITE alpha');
  await untilWhere(gui.sessionState, state => state.hasAlpha, '完成 alpha');
  await gui.submit('MOOS_FIXTURE_WRITE beta');
  const parent = await untilWhere(gui.sessionState, state => state.hasBeta && state.branchButtons >= 2, 'both turns completed');
  const sessionA = globalThis.sessionA = parent.session;
  assert.ok(sessionA, 'parent session id visible');
  await gui.dump('sidebar-before-branch');
  // Branch from turn 1: the first available branch action in document order.
  await gui.evaluate(`document.querySelectorAll('button[aria-label="在新对话中分支"]')[0].click()`);
  const branched = await untilWhere(gui.sessionState, state => state.session && state.session !== sessionA, 'branch session opened');
  const sessionB = globalThis.sessionB = branched.session;
  assert.equal(branched.hasBeta, false, 'branch excludes the later turn');
  assert.equal(branched.hasAlpha, true, 'branch shows the selected turn');
  assert.match(branched.summary ?? '', /已完成/, 'inherited PI process card visible right after branching');
  await gui.capture('branch-view');
  await gui.dump('sidebar-after-branch');
  const exit1 = await gui.stop();
  assert.equal(exit1.code, 0, 'first graceful exit');
  const afterBranch = readDb();

  // Phase 2: full restart on the same data dir; the branch conversation must survive.
  const gui2 = await launch();
  const reopened = await untilWhere(gui2.sessionState, state => state.session !== null, 'session id after restart');
  let reopenMethod = reopened.session === sessionB ? 'auto-restore' : null;
  let reopenedTitle = null;
  if (!reopenMethod) {
    // The app starts on a fresh conversation; reselect the branch row in the sidebar.
    // Both conversations may share a similar title, so click matching rows in order
    // until the branch session is active, then confirm by session id.
    await gui2.dump('sidebar-after-restart');
    const titles = await gui2.evaluate(`(() => {
      const rows = [...document.querySelectorAll('[class*="sessionRow"]')];
      if (rows.length) return rows.map(el => (el.textContent || '').trim().replace(/\\s+/g, ' '));
      const loose = new Set();
      for (const el of document.querySelectorAll('a, button, [role="button"], li, [tabindex]')) {
        const text = (el.textContent || '').trim().replace(/\\s+/g, ' ');
        if (text && text.length <= 120 && text.includes('MOOS_FIXTURE_WRITE')) loose.add(text);
      }
      return [...loose];
    })()`);
    for (const title of titles) {
      const clicked = await gui2.evaluate(`(() => {
        const text = ${JSON.stringify(title)};
        const rows = [...document.querySelectorAll('[class*="sessionRow"]')]
          .filter(el => (el.textContent || '').trim().replace(/\\s+/g, ' ') === text);
        const targets = rows.length ? rows
          : [...document.querySelectorAll('a, button, [role="button"], li, [tabindex]')]
            .filter(el => (el.textContent || '').trim().replace(/\\s+/g, ' ') === text);
        if (targets[0]) { targets[0].click(); return true; }
        return false;
      })()`);
      if (!clicked) continue;
      const state = await untilWhere(gui2.sessionState, s => s.session !== null, 'session id after click').catch(() => null);
      if (state?.session === sessionB) { reopenMethod = 'sidebar-row-click'; reopenedTitle = title; break; }
    }
  }
  assert.ok(reopenMethod, 'branch conversation reopened after full restart');
  const restored = await untilWhere(gui2.sessionState, state => state.session === sessionB && state.hasAlpha
    && !state.hasBeta && /已完成/.test(state.summary ?? ''), 'inherited process card restored after restart');
  await gui2.capture('restart-view');
  const exit2 = await gui2.stop();
  assert.equal(exit2.code, 0, 'second graceful exit');
  const afterRestart = readDb();

  // Restart + reopen must not create tasks, events or conversations; the branch PI session
  // stays uncreated (nothing submitted there) while the inherited references persist.
  assert.equal(afterRestart.events, afterBranch.events, 'no new events after restart/reopen');
  assert.equal(afterRestart.tasks.length, afterBranch.tasks.length, 'no new tasks after restart/reopen');
  assert.equal(afterRestart.conversationIds.length, afterBranch.conversationIds.length, 'no new moos conversations');
  assert.equal(afterRestart.sessionB, null, 'branch has no PI session until the user submits');
  assert.ok(afterRestart.sessionA, 'parent PI conversation registered');
  assert.ok(afterRestart.inheritedKeys.some(key => key.startsWith('dsh-inherited-turn:' + sessionB + ':')),
    'inherited process references persisted in SQLite');
  assert.equal(afterRestart.tasks.length, 2, 'exactly the two parent tasks exist');

  const report = {
    shellVersion,
    scenario: 'two MOOS_FIXTURE_WRITE turns (desktopPolicy shell variant) -> branch from turn 1 -> full app restart -> reopen branch',
    checks: {
      parentSessionId: sessionA, branchSessionId: sessionB,
      branchViewExcludesLaterTurn: branched.hasBeta === false,
      branchViewShowsSelectedTurn: branched.hasAlpha === true,
      inheritedCardAfterBranch: /已完成/.test(branched.summary ?? ''), branchSummary: branched.summary,
      firstExit: exit1, secondExit: exit2,
      branchReopenMethod: reopenMethod, reopenedSidebarTitle: reopenedTitle,
      inheritedCardAfterRestart: /已完成/.test(restored.summary ?? ''), restartSummary: restored.summary,
      restartViewExcludesLaterTurn: restored.hasBeta === false,
      tasksAfterBranch: afterBranch.tasks.length, tasksAfterRestart: afterRestart.tasks.length,
      eventsAfterBranch: afterBranch.events, eventsAfterRestart: afterRestart.events,
      branchHasNoPiSession: afterRestart.sessionB === null,
      inheritedRefsPersisted: afterRestart.inheritedKeys.length,
      parentHasPiSession: afterRestart.sessionA !== null,
    },
    limits: [
      'Over-limit (>1600 inherited events) behaviour is covered by unit tests in fork-process.test.mjs, not by a real 1600+ event session here.',
      'Isolated copied bundle with show() suppressed; production app and user data untouched.',
    ],
  };
  await writeFile(join(scratch, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(scratch, 'exit.json'), JSON.stringify({ exit1, exit2 }) + '\n');
  await relay.close();
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (child && child.exitCode === null) { child.kill('SIGKILL'); }
  for (const socket of sockets) socket.close().catch?.(() => {});
  throw error;
}
