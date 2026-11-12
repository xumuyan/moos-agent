// Explicit isolated Electron acceptance for P03.13.17 (project-independent queues, default
// concurrency four, queue card states). Never targets the installed Moos or user data.
// Covered here (GUI, isolated):
//  1. A queued task whose project has a running task renders 「排队中 · 等待本项目上一任务完成」
//     (projectRunning=true, zero same-project tasks ahead).
//  2. A second queued task in the same project renders 「排队中 · 本项目前方 1 个任务」.
//  3. The per-project queue drains in FIFO order; all tasks reach succeeded with
//     queued -> running -> succeeded task_state events.
// NOT covered here (honest limits, see report.limits):
//  - Cross-project non-blocking and the four-slot cap are covered by unit tests
//    (services/agent/scheduler.test.mjs five-project case; apps/electron/pi-turn.test.mjs
//    cross-project case; client.test.mjs renders all three queued card states).
//  - The third card state 「排队中 · 等待空闲执行位」 needs four other projects busy; not built in GUI.
// Flow: WRITE pre (completes) -> HOLD (running 25s) -> branch -> WRITE alpha (queued,
// waits on project task) -> back to first conversation -> branch again -> WRITE beta
// (queued, 前方 1) -> capture -> wait for drain -> SQLite checks -> graceful quit.
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
if (!clientSource.includes('data-moos-queued')) throw new Error('Isolated build lacks the queued process card');
if (!clientSource.includes('等待本项目上一任务完成') || !clientSource.includes('本项目前方') || !clientSource.includes('等待空闲执行位')) {
  throw new Error('Isolated build lacks the three-state queued card copy');
}
const schedulerSource = await readFile(join(resources, 'pi-runtime/services/agent/scheduler.mjs'), 'utf8');
if (!schedulerSource.includes("errorCode: 'timeout'")) throw new Error('Isolated build lacks timeout enforcement');
if (!schedulerSource.includes('concurrency = 4')) throw new Error('Isolated build lacks default concurrency four');
const entry = join(resources, 'app/main.mjs');
await writeFile(entry, (await readFile(entry, 'utf8')).replace("app.setName('沐码');", "BrowserWindow.prototype.show = function () {};\napp.setName('沐码');"));
execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'ignore' });
const data = join(scratch, 'data');
const home = join(data, 'dsh');
await seedHome(resources, home);
const relay = await startFixture({ desktopPolicy: true });
await piModels(data, checkedProvider).save({ id: 'queue-fixture', name: '排队可见隔离验收', model: 'moos-fixture',
  baseUrl: relay.baseUrl, service: 'openai', api: 'openai-completions', apiKey: relay.apiKey });

const sockets = [];
let child;
let lastObserved = null;
async function until(fn, label) {
  for (let i = 0; i < 240; i++) {
    const result = await fn().catch(error => ({ pollError: String(error && error.message || error) }));
    if (result && !result.pollError) { lastObserved = result; return result; }
    await writeFile(join(scratch, 'until-debug.json'), JSON.stringify({ label, i, poll: result, last: lastObserved }, null, 1) + '\n').catch(() => {});
    if (child?.exitCode !== null) break;
    await sleep(250);
  }
  throw new Error('Did not observe ' + label + ' | last=' + JSON.stringify(lastObserved));
}
async function untilWhere(fn, predicate, label) {
  return until(async () => {
    const value = await fn();
    if (value) lastObserved = value;
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
    const cards = [...document.querySelectorAll('[data-moos-pi-process]')];
    const last = cards[cards.length - 1] ?? null;
    const summary = last?.querySelector('summary')?.textContent ?? null;
    return {
      session: document.querySelector('[data-conversation-session]')?.getAttribute('data-conversation-session') ?? null,
      processCards: cards.length,
      processCard: last?.textContent ?? null,
      processSummary: summary,
      queuedCard: last?.matches('[data-moos-queued]') ? (summary ?? '') : null,
      hasPre: text.includes('完成 pre'), hasAlpha: text.includes('完成 alpha'), hasBeta: text.includes('完成 beta'),
    };
  })()`);
  const clickRowUntilSession = async targetSession => {
    const rows = await evaluate(`(() => [...document.querySelectorAll('[class*="sessionRow"]')]
      .map(el => (el.textContent || '').trim().replace(/\\s+/g, ' ')).filter(Boolean))()`);
    for (const title of rows) {
      await evaluate(`(() => {
        const text = ${JSON.stringify(title)};
        const targets = [...document.querySelectorAll('[class*="sessionRow"]')]
          .filter(el => (el.textContent || '').trim().replace(/\\s+/g, ' ') === text);
        if (targets[0]) { targets[0].click(); return true; }
        return false;
      })()`);
      const state = await untilWhere(sessionState, s => s.session !== null, 'session id after row click').catch(() => null);
      if (state?.session === targetSession) return state;
    }
    return null;
  };
  const db = () => {
    const handle = new DatabaseSync(join(data, 'pi/moos.sqlite'), { readOnly: true });
    try {
      return {
        tasks: handle.prepare('select id, conversationId, status, errorCode, timeoutMs from tasks order by rowid').all(),
        stateEvents: handle.prepare("select taskId, payload from events where type = 'task_state' order by rowid").all()
          .map(row => ({ task: row.taskId.slice(0, 8), status: JSON.parse(row.payload).status })),
        queuedAheadOf: id => {
          const fresh = new DatabaseSync(join(data, 'pi/moos.sqlite'), { readOnly: true });
          try {
            return fresh.prepare(
              "select count(*) n from tasks where status = 'queued' and projectId = (select projectId from tasks where id = ?) and rowid < (select rowid from tasks where id = ?)").get(id, id).n;
          } finally { fresh.close(); }
        },
      };
    } finally { handle.close(); }
  };
  return { call, evaluate, capture, submit, sessionState, db, clickRowUntilSession,
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

const short = id => String(id).slice(0, 8);
try {
  const gui = await launch();
  // Turn 1 completes immediately; turn 2 holds the project slot for ~25s.
  await gui.submit('MOOS_FIXTURE_WRITE pre');
  const first = await untilWhere(gui.sessionState,
    state => state.hasPre && /已完成/.test(state.processSummary ?? ''), '完成 pre with settled card');
  const session1 = globalThis.session1 = first.session;
  assert.ok(session1, 'first conversation session id visible');
  await gui.submit('MOOS_FIXTURE_HOLD');
  await untilWhere(gui.sessionState, state => state.processCards === 2 && /正在执行/.test(state.processSummary ?? ''),
    'HOLD turn running as the second card');
  const runningDb = gui.db();
  const holdTask = runningDb.tasks.find(task => task.status === 'running');
  assert.ok(holdTask, 'HOLD task is running in the store');
  assert.equal(runningDb.tasks.find(task => task.status === 'succeeded')?.status, 'succeeded', 'pre task succeeded');

  // Branch from the completed first turn -> conversation 2; submit alpha while HOLD owns the slot.
  await gui.evaluate(`document.querySelectorAll('button[aria-label="在新对话中分支"]')[0].click()`);
  const second = await untilWhere(gui.sessionState, state => state.session && state.session !== session1, 'branch conversation 2 opened');
  const session2 = globalThis.session2 = second.session;
  await gui.submit('MOOS_FIXTURE_WRITE alpha');
  const alphaQueued = await untilWhere(gui.sessionState, state => (state.queuedCard ?? '') === '排队中 · 等待本项目上一任务完成',
    'alpha queued card waiting on its project task');
  await gui.capture('alpha-queued-view');
  const alphaDb = gui.db();
  const alphaTask = alphaDb.tasks.find(task => task.status === 'queued' && task.id !== holdTask.id);
  assert.ok(alphaTask, 'alpha task queued in the store');
  assert.equal(alphaTask.timeoutMs, 7200000, 'default timeout stored');
  assert.equal(alphaDb.queuedAheadOf(alphaTask.id), 0, 'read model queue count agrees with the store');

  // Back to conversation 1, branch again -> conversation 3; beta must report one queued ahead.
  const back = await gui.clickRowUntilSession(session1);
  assert.ok(back, 'returned to conversation 1 via sidebar');
  await gui.evaluate(`document.querySelectorAll('button[aria-label="在新对话中分支"]')[0].click()`);
  const third = await untilWhere(gui.sessionState, state => state.session && state.session !== session1 && state.session !== session2,
    'branch conversation 3 opened');
  const session3 = globalThis.session3 = third.session;
  await gui.submit('MOOS_FIXTURE_WRITE beta');
  const betaQueued = await untilWhere(gui.sessionState, state => (state.queuedCard ?? '') === '排队中 · 本项目前方 1 个任务',
    'beta queued card with one same-project task ahead');
  await gui.capture('queue-view');
  const betaDb = gui.db();
  const betaTask = betaDb.tasks.find(task => task.status === 'queued' && ![holdTask.id, alphaTask.id].includes(task.id));
  assert.ok(betaTask, 'beta task queued in the store');
  const betaAheadAtSnapshot = betaDb.queuedAheadOf(betaTask.id);
  assert.equal(betaAheadAtSnapshot, 1, 'exactly alpha sits ahead of beta');
  assert.equal(betaDb.tasks.find(task => task.id === holdTask.id).status, 'running', 'HOLD still owns the slot while beta waits');

  // The queue drains in FIFO order once HOLD finishes; each queued task records queued -> running -> succeeded.
  const drained = await untilWhere(gui.sessionState, state => state.hasBeta
    && /已完成/.test(state.processSummary ?? '') && !state.queuedCard, 'beta completed after drain');
  await gui.capture('drained-view');
  const drainDb = gui.db();
  assert.equal(drainDb.tasks.length, 4, 'exactly four tasks: pre, HOLD, alpha, beta');
  for (const task of drainDb.tasks) assert.equal(task.status, 'succeeded', 'all tasks drained to succeeded');
  const byTask = {};
  for (const row of drainDb.stateEvents) (byTask[row.task] ??= []).push(row.status);
  const holdId = short(holdTask.id);
  assert.deepEqual(byTask[holdId], ['queued', 'running', 'succeeded'], 'HOLD lifecycle');
  assert.deepEqual(byTask[short(alphaTask.id)], ['queued', 'running', 'succeeded'], 'alpha lifecycle through the queue');
  assert.deepEqual(byTask[short(betaTask.id)], ['queued', 'running', 'succeeded'], 'beta lifecycle through the queue');
  const exit = await gui.stop();
  assert.equal(exit.code, 0, 'graceful exit');
  const afterQuit = gui.db();
  assert.equal(afterQuit.tasks.length, 4, 'quit adds no tasks');
  assert.equal(afterQuit.tasks.every(task => task.status === 'succeeded'), true, 'no task left active after quit');

  const report = {
    shellVersion,
    scenario: 'WRITE pre -> HOLD (running) -> branch -> WRITE alpha (queued, waits on project task) -> branch -> WRITE beta (queued, 前方 1) -> drain -> quit',
    checks: {
      sessions: { first: session1, second: session2, third: session3 },
      alphaQueuedSummary: alphaQueued.queuedCard, betaQueuedSummary: betaQueued.queuedCard,
      alphaWaitsOnProjectTask: (alphaQueued.queuedCard ?? '') === '排队中 · 等待本项目上一任务完成',
      betaQueuedWithOneAhead: (betaQueued.queuedCard ?? '') === '排队中 · 本项目前方 1 个任务',
      holdStillRunningWhileBetaQueued: betaDb.tasks.find(task => task.id === holdTask.id).status === 'running',
      storeQueueAheadOfBetaAtSnapshot: betaAheadAtSnapshot,
      defaultTimeoutMs: alphaTask.timeoutMs,
      betaDrainedSummary: drained.processCard,
      tasksTotal: afterQuit.tasks.length,
      lifecycleByTask: byTask,
      exit,
      timeoutEnforcementCoveredBy: 'services/agent/scheduler.test.mjs (injected fake clock), packaged scheduler.mjs contains errorCode timeout',
    },
    limits: [
      'Cross-project non-blocking (four distinct projects run in parallel) and the four-slot cap are covered by unit tests, not this GUI run.',
      'The third queued card state 「排队中 · 等待空闲执行位」 requires four other busy projects; not built in this GUI scenario.',
      'Timeout enforcement stays covered by scheduler unit tests with an injected fake clock.',
      'Isolated copied bundle with show() suppressed; production app and user data untouched.',
    ],
  };
  await writeFile(join(scratch, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(scratch, 'exit.json'), JSON.stringify({ exit }) + '\n');
  await relay.close();
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (child && child.exitCode === null) { child.kill('SIGKILL'); }
  for (const socket of sockets) { try { socket.close(); } catch {} }
  throw error;
}
