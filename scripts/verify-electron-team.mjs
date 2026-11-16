// Isolated hidden-window renderer/Host/PI acceptance. Not normal desktop-input QA.
import assert from 'node:assert/strict';
import { instrumentQaShutdown, parseQaShutdown, snapshotQaProcesses } from './team-qa-shutdown.mjs';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, writeFile, appendFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { checkedProvider } from '../packages/pi-adapter/index.mjs';
import { piModels } from '../apps/electron/plugin/pi-models.js';
import { seedHome } from '../apps/electron/profile-home.mjs';
const [inputApp, scenario = 'success'] = process.argv.slice(2);
assert.ok(['success', 'blocked', 'stop', 'retry', 'attachments', 'stop-retry', 'interrupt-retry', 'shell-stop'].includes(scenario), 'Unsupported QA scenario');
const retrying = ['retry', 'stop-retry', 'interrupt-retry'].includes(scenario);
const shellStop = scenario === 'shell-stop';
const stopping = ['stop', 'stop-retry', 'shell-stop'].includes(scenario);
const interrupted = scenario === 'interrupt-retry';
const partial = stopping || interrupted;
const successful = ['success', 'attachments'].includes(scenario);
const repo = process.cwd(), allowed = join(repo, '.generated/moos-electron') + sep;
assert.ok(resolve(inputApp).startsWith(allowed) && (await realpath(inputApp)).startsWith(allowed));
const blockQuit = process.env.MOOS_QA_BLOCK_QUIT === '1';
const historyReload = process.env.MOOS_QA_HISTORY_RELOAD === '1';
assert.ok(!historyReload || ['success', 'blocked'].includes(scenario), 'History reload QA requires success or blocked');
const activeReload = process.env.MOOS_QA_ACTIVE_RELOAD === '1';
assert.ok(!activeReload || ['stop', 'shell-stop'].includes(scenario), 'Active reload QA requires stop or shell-stop');
const reportedUsage = process.env.MOOS_QA_REPORTED_USAGE === '1';
assert.ok(!reportedUsage || ['success', 'blocked'].includes(scenario), 'Reported usage QA requires success or blocked');
const scratch = await mkdtemp(join(repo, 'artifacts/team-ui/gui-'));
const app = join(scratch, 'QA.app');
execFileSync('/usr/bin/ditto', [resolve(inputApp), app]);
const resources = join(app, 'Contents/Resources'), entry = join(resources, 'app/main.mjs');
let main = await readFile(entry, 'utf8');
assert.ok(main.includes("app.setName('沐码');"));
await writeFile(entry, instrumentQaShutdown(main, { blockQuit }).replace("app.setName('沐码');", "BrowserWindow.prototype.show = function () {};\napp.setName('沐码');"));
execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'ignore' });
const data = join(scratch, 'data'); await seedHome(resources, join(data, 'dsh'));
const errors = [], requests = [];
let shellPids;
let heldRequest = false, heldRequestClosed = false, planningRounds = 0;
const largeUpload = 'UPLOAD_LARGE_42\n' + 'synthetic upload line\n'.repeat(7000);
const largeUploadPath = '.moos-uploads/' + createHash('sha256').update(largeUpload).digest('hex').slice(0, 8) + '-payload.log';
let releaseAttachments;
const attachmentsQueued = new Promise(resolve => { releaseAttachments = resolve; });
const roleStarts = [], originalGoal = 'Create answer.txt with 42 and independently verify it';
const server = createServer(async (req, res) => {
  try {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    const user = body.messages.filter(item => item.role === 'user').at(-1);
    const prompt = typeof user.content === 'string' ? user.content : user.content.map(part => part.text ?? '').join('');
    const names = body.tools?.map(item => item.function.name) ?? [];
    const latest = body.messages.at(-1).role === 'tool' ? body.messages.at(-1) : undefined;
    const latestTool = latest && body.messages.flatMap(item => item.tool_calls ?? [])
      .find(call => call.id === latest.tool_call_id)?.function.name;
    let name, args, content;
    const planning = names.includes('team_plan');
    if (planning && !body.messages.some(item => item.role === 'tool')) planningRounds++;
    if (!latest && !body.messages.some(item => item.role === 'tool')
      && (planning || names.includes('team_verdict') || prompt.includes('当前任务build'))) {
      roleStarts.push({ round: planningRounds, role: planning ? 'captain' : names.includes('team_verdict') ? 'verifier' : 'implementer',
        priorAssistant: body.messages.some(item => item.role === 'assistant') });
    }
    const retryRound = retrying && planningRounds === 2;
    if (prompt.includes('只根据已有工具/成员证据')) content = 'TEAM_GUI_DELIVERED_42';
    else if (planning) {
      if (scenario === 'attachments') {
        assert.ok(prompt.includes('UPLOAD_INLINE_42') && prompt.includes(largeUploadPath));
        if (!latest) await attachmentsQueued;
        else if (latestTool === 'read') assert.ok(latest.content.includes('UPLOAD_LARGE_42'));
      }
      if (retryRound) {
        assert.ok(prompt.includes(originalGoal) && prompt.includes('这是用户显式重试的团队任务'));
        assert.ok(prompt.includes('禁止盲目重复安装、提交、发送或部署'));
      }
      if (scenario === 'attachments' && !latest) { name = 'read'; args = { path: largeUploadPath, limit: 2 }; }
      else if (retryRound && !latest) { name = 'read'; args = { path: 'answer.txt' }; }
      else if (latest && latestTool !== 'read') content = 'planned'; else { name = 'team_plan'; args = { tasks: [
        { id: 'build', role: 'implementer', goal: 'Write answer.txt as 42', dependsOn: [] },
        { id: 'check', role: 'verifier', goal: 'Read answer.txt and verify 42', dependsOn: ['build'] },
        ...(scenario === 'blocked' ? [{ id: 'final', role: 'verifier', goal: 'Final independent check', dependsOn: ['check'] }] : []),
      ] }; }
    } else if (names.includes('team_verdict')) {
      if (!latest) { name = 'read'; args = { path: 'answer.txt' }; }
      else if (latestTool === 'read' || latest.content.includes('42')) {
        const blocked = scenario === 'blocked' || scenario === 'retry' && !retryRound;
        assert.ok(latest.content.includes('42')); name = 'team_verdict'; args = { passed: !blocked, summary: blocked ? 'synthetic acceptance blocked' : 'read confirmed 42' };
      } else content = 'verified';
    } else if (prompt.includes('当前任务build')) {
      if (shellStop && !latest) {
        name = 'bash'; args = { command: `printf '42\\n' > answer.txt; printf '%s\\n' "$$" > shell.pid; /bin/sleep 120 & worker=$!; printf '%s\\n' "$worker" > child.pid; wait "$worker"; printf 'UNEXPECTED_LATE_WRITE\\n' > late.txt`, timeout: 150 };
      } else if (scenario === 'attachments' && !latest) {
        assert.ok(prompt.includes('UPLOAD_INLINE_42') && prompt.includes(largeUploadPath));
        name = 'read'; args = { path: largeUploadPath, limit: 2 };
      } else if (scenario === 'attachments' && latestTool === 'read') {
        assert.ok(latest.content.includes('UPLOAD_LARGE_42')); name = 'write'; args = { path: 'answer.txt', content: '42\n' };
      } else if (latest) { if (retryRound) assert.ok(latest.content.includes('42')); content = 'written'; }
      else if (retryRound) { name = 'read'; args = { path: 'answer.txt' }; }
      else { name = 'write'; args = { path: 'answer.txt', content: '42\n' }; }
    } else {
      if (scenario === 'attachments') assert.ok(prompt.includes('QUEUE_ATTACHMENT_42'), 'queued ordinary input retains uploaded text');
      content = 'ORDINARY_GUI_REPLY';
    }
    // Hold an actual implementer request until the UI Stop cancels it.
    // stop holds before write; stop-retry holds after actual write, before the
    // member turn ends. This tests retained side effects, not active-shell Stop.
    if (prompt.includes('当前任务build') && (scenario === 'stop' && !latest
      || ['stop-retry', 'interrupt-retry'].includes(scenario) && !retryRound && latestTool === 'write')) {
      heldRequest = true;
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 30000);
        res.once('close', () => { heldRequestClosed = true; clearTimeout(timer); resolve(); });
      });
      if (!res.destroyed) res.end();
      return;
    }
    // Leave the team live long enough to observe state and change future mode.
    if (names.includes('team_plan') && !latest) await sleep(2500);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const delta = name ? { tool_calls: [{ index: 0, id: 'call-' + requests.length, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } : { content };
    for (const [part, finish] of [[delta, null], [{}, name ? 'tool_calls' : 'stop']]) res.write('data: ' + JSON.stringify({
      id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: part, finish_reason: finish }] }) + '\n\n');
    if (reportedUsage) res.write('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }) + '\n\n');
    res.end('data: [DONE]\n\n');
  } catch (error) { errors.push(error.message); res.writeHead(500); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
await piModels(data, checkedProvider).save({ id: 'gui', model: 'fixture-model', api: 'openai-completions',
  baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'synthetic-local-only' });
const env = { ...process.env, TMPDIR: '/private/tmp/' };
for (const key of Object.keys(env)) if (key.startsWith('MOOS_ELECTRON_') || key.startsWith('DSH_') || ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH'].includes(key)) delete env[key];
env.MOOS_ELECTRON_DATA = data;
let child, closed, lines, port, socket;
const shutdownEvents = [];
function launch() {
  port = undefined;
  child = spawn(join(app, 'Contents/MacOS/MuMa'), ['--remote-debugging-port=0'], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  const own = child;
  closed = new Promise(r => own.once('exit', r));
  lines = createInterface({ input: own.stderr });
  lines.on('line', line => { const shutdown = parseQaShutdown(line); if (shutdown) shutdownEvents.push(shutdown); const m = line.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/); if (m) port = m[1]; void appendFile(join(scratch, 'app.log'), line + '\n'); });
}
launch();
async function until(fn, label) {
  for (let i = 0; i < 240; i++) { const result = await fn(); if (result) return result; if (child.exitCode !== null) break; await sleep(250); }
  throw new Error('Missing ' + label);
}
const report = { scenario, scope: 'isolated copied QA bundle with show suppressed; CDP input; synthetic local model', checks: {}, productionTouched: false, normalGUI: false, externalModel: false };
try {
  let call, evaluate;
  async function connect() {
    await until(async () => port, 'debug port');
    const target = await until(async () => (await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json())).find(row => row.url.startsWith('http://127.0.0.1:')), 'workbench');
    socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => socket.addEventListener('open', r, { once: true }));
    const ownSocket = socket;
    let seq = 0; const pending = new Map();
    ownSocket.addEventListener('message', event => { const result = JSON.parse(event.data); pending.get(result.id)?.(result); });
    call = (method, params = {}) => new Promise((r, j) => {
      const id = ++seq, timer = setTimeout(() => { pending.delete(id); j(new Error('CDP timeout')); }, 15000);
      pending.set(id, response => { clearTimeout(timer); pending.delete(id); response.error ? j(new Error(response.error.message)) : r(response.result); });
      ownSocket.send(JSON.stringify({ id, method, params }));
    });
    evaluate = async expression => { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  }
  await connect();
  const capture = async name => writeFile(join(scratch, name + '.png'), Buffer.from((await call('Page.captureScreenshot')).data, 'base64'));
  await until(() => evaluate(`(() => { const el = document.querySelector('[data-composer-input]'); if (!el) return false; if (el.dataset.phase === 'inert') { el.click(); return false; } return el.contentEditable === 'true'; })()`), 'active composer');
  await sleep(1200);
  await evaluate(`(() => { const cancel = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === '取消'); cancel?.click(); })()`);
  await until(() => evaluate(`(() => { const button = document.querySelector('button[aria-label="添加文件或调用指令"]'); if (!button) return false; button.click(); return true; })()`), 'plus menu');
  await until(() => evaluate(`(() => { const el = [...document.querySelectorAll('[role="menuitem"], [role="option"], button')].find(el => el.textContent.trim().startsWith('团队协作')); if (!el) return false; el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); return true; })()`), 'team menu action');
  await until(() => evaluate(`!!document.querySelector('[data-moos-team-mode]')`), 'team tag');
  await capture('team-selected'); report.checks.menuAndTag = true;
  async function upload(files) {
    // Browser-created Files have no OS path: they take the real upload/receipt
    // route, not Electron's local-path mention shortcut. No service is mocked.
    await evaluate(`(() => {
      const input = document.querySelector('input[type="file"]');
      if (!input || input.disabled) throw new Error('file intake unavailable');
      const transfer = new DataTransfer();
      for (const file of ${JSON.stringify(files)}) transfer.items.add(new File([file.content], file.name, { type: 'text/plain' }));
      input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    for (const file of files) await until(() => evaluate(`document.body.innerText.includes(${JSON.stringify(file.name)})`), 'attachment chip ' + file.name);
  }
  async function send(text, label = '发送消息') {
    await evaluate(`document.querySelector('[data-composer-input]').focus()`);
    await call('Input.insertText', { text });
    await until(() => evaluate(`(() => { const button = document.querySelector('button[aria-label="${label}"]'); if (!button || button.disabled) return false; button.click(); return true; })()`), 'send');
  }
  if (scenario === 'attachments') {
    // Uploads can succeed while task admission rejects the message. Exercise
    // the real eight-file route limit without manufacturing a network error.
    await upload(Array.from({ length: 9 }, (_, index) => ({ name: `over-${index}.txt`, content: 'synthetic rejected input' })));
    await send('Reject nine attachments without starting a task');
    await until(() => evaluate(`document.body.innerText.includes('附件处理失败。每条消息最多 8 个附件')`), 'visible attachment admission failure');
    assert.equal(requests.length, 0, 'invalid attachment submission must not reach model');
    const rejectedDb = new DatabaseSync(join(data, 'pi/moos.sqlite'), { readOnly: true });
    try { assert.equal(rejectedDb.prepare('SELECT COUNT(*) AS count FROM tasks').get().count, 0); }
    finally { rejectedDb.close(); }
    assert.equal(await evaluate(`!!document.querySelector('[data-moos-team-mode]')`), true);
    report.checks.attachmentAdmissionFailureNoTask = true;
    await capture('team-attachments-rejected');
    await upload([
      { name: 'goal.txt', content: 'UPLOAD_INLINE_42\n' },
      { name: 'payload.log', content: largeUpload },
    ]);
  }
  await send(originalGoal);
  await until(() => evaluate(`!!document.querySelector('[data-moos-team-progress]')`), 'live team progress');
  await evaluate(`document.querySelector('[data-moos-pi-process]')?.setAttribute('open','')`);
  await capture('team-live'); report.checks.liveProgress = true;
  await evaluate(`document.querySelector('[aria-label="退出团队模式（不停止任务）"]').click()`);
  await until(() => evaluate(`!document.querySelector('[data-moos-team-mode]')`), 'tag cleared');
  if (scenario === 'attachments') {
    await upload([{ name: 'queued.txt', content: 'QUEUE_ATTACHMENT_42\n' }]);
    await send('Reply ordinary', '排队发送');
    await until(() => evaluate(`document.querySelector('[data-composer-input]').innerText.trim() === ''`), 'queued draft settled');
    await evaluate(`document.querySelector('button[aria-label="添加文件或调用指令"]').click()`);
    await until(() => evaluate(`(() => { const el = [...document.querySelectorAll('[role="menuitem"], [role="option"], button')].find(el => el.textContent.trim().startsWith('团队协作')); if (!el) return false; el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); return true; })()`), 'select future team mode');
    await until(() => evaluate(`!!document.querySelector('[data-moos-team-mode]')`), 'future team tag');
    assert.equal(requests.some(body => !body.tools?.some(item => item.function.name === 'team_plan') && JSON.stringify(body.messages).includes('QUEUE_ATTACHMENT_42')), false, 'queued ordinary has not run before release');
    report.checks.actualUploadsAndQueueAdmission = true;
    await capture('team-attachments-queued');
    releaseAttachments();
  }
  if (shellStop) {
    const active = new DatabaseSync(join(data, 'pi/moos.sqlite'), { readOnly: true });
    try {
      const owner = await until(() => active.prepare('SELECT tasks.id, tasks.status, projects.path FROM tasks JOIN projects ON projects.id = tasks.projectId ORDER BY tasks.rowid').get(), 'shell task owner');
      shellPids = await until(async () => {
        try {
          const pids = await Promise.all(['shell.pid', 'child.pid'].map(file => readFile(join(owner.path, file), 'utf8').then(text => Number(text.trim()))));
          return pids.every(pid => Number.isSafeInteger(pid) && pid > 1) && pids;
        } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
      }, 'actual shell and child PID files');
      assert.notEqual(shellPids[0], shellPids[1]);
      const parent = pid => Number(execFileSync('/bin/ps', ['-p', String(pid), '-o', 'ppid='], { encoding: 'utf8' }).trim());
      assert.equal(parent(shellPids[1]), shellPids[0], 'actual sleep belongs to actual running shell');
      let ancestor = shellPids[0]; const seen = new Set();
      while (ancestor !== child.pid && ancestor > 1 && !seen.has(ancestor)) { seen.add(ancestor); ancestor = parent(ancestor); }
      assert.equal(ancestor, child.pid, 'shell must belong to this exact copied QA instance');
      assert.equal(active.prepare('SELECT status FROM tasks WHERE id = ?').get(owner.id).status, 'running');
      assert.equal(await readFile(join(owner.path, 'answer.txt'), 'utf8'), '42\n');
      await assert.rejects(readFile(join(owner.path, 'late.txt')), { code: 'ENOENT' });
      assert.ok(active.prepare('SELECT payload FROM events WHERE taskId = ? AND type = ?').all(owner.id, 'tool_start').some(row => { const p = JSON.parse(row.payload); return p.member === 'implementer' && p.toolName === 'bash'; }));
      report.checks.actualOwnedShellAndChildRunning = true;
    } finally { active.close(); }
  }
  if (activeReload) {
    if (!shellStop) await until(() => heldRequest, 'held request before active reload');
    const activeDb = new DatabaseSync(join(data, 'pi/moos.sqlite'), { readOnly: true });
    try {
      const snapshot = () => ({
        tasks: activeDb.prepare('SELECT id, status, message FROM tasks ORDER BY rowid').all(),
        events: activeDb.prepare('SELECT id, taskId, type, payload FROM events ORDER BY id').all(),
      });
      const before = snapshot(), count = requests.length, pid = child.pid;
      assert.equal(before.tasks.length, 1);
      assert.equal(before.tasks[0].status, 'running');
      const projection = () => evaluate(`(() => {
        document.querySelectorAll('[data-moos-pi-process], [data-moos-team-node-details]').forEach(el => el.setAttribute('open', ''));
        return [...document.querySelectorAll('[data-moos-team-progress]')].map(el => el.innerText);
      })()`);
      const original = await until(async () => {
        const current = await projection();
        return current.length === 1 && current[0].includes('build') && current;
      }, 'live build node before reload');
      await call('Page.reload', { ignoreCache: true });
      await until(() => evaluate(`(() => { const el = [...document.querySelectorAll('*')].find(el => el.children.length === 0 && el.textContent.startsWith('Create answer.txt with 42')); el?.click(); return !!el; })()`), 'active saved conversation after reload');
      await until(async () => JSON.stringify(await projection()) === JSON.stringify(original), 'identical active team projection');
      await until(() => evaluate(`!!document.querySelector('button[aria-label="停止生成"]:not(:disabled)')`), 'restored active Stop');
      assert.equal(await evaluate(`!!document.querySelector('[data-moos-team-mode]')`), false);
      assert.equal(await evaluate(`!!document.querySelector('[data-moos-pi-retry] button')`), false);
      await sleep(1000);
      assert.deepEqual(snapshot(), before, 'active reload must not mutate tasks/events');
      assert.equal(requests.length, count, 'active reload must not duplicate model requests');
      assert.equal(child.pid, pid); assert.equal(child.exitCode, null);
      if (!shellStop) assert.equal(heldRequestClosed, false, 'reload must not close active model response');
      else {
        for (const pid of shellPids) process.kill(pid, 0);
        const parent = Number(execFileSync('/bin/ps', ['-p', String(shellPids[1]), '-o', 'ppid='], { encoding: 'utf8' }).trim());
        assert.equal(parent, shellPids[0], 'original shell and direct child survive reload');
      }
      report.checks.activeReloadProjectionAndControls = true;
      report.checks.activeReloadNoReplayOrEventMutation = true;
      report.checks.activeReloadOriginalWorkSurvives = true;
      report.activeReload = { observationMs: 1000, taskCount: before.tasks.length,
        eventCount: before.events.length, modelRequestsBefore: count, modelRequestsAfter: requests.length,
        projectionEqual: true, tasksAndEventsEqual: true, appRelaunched: false,
        work: shellStop ? 'owned-shell-and-direct-sleep' : 'held-implementer-response' };
      await capture('team-active-reloaded');
    } finally { activeDb.close(); }
  }
  if (stopping) {
    if (!shellStop) await until(() => heldRequest, 'active implementer model request');
    await until(() => evaluate(`(() => { const button = document.querySelector('button[aria-label="停止生成"]'); if (!button || button.disabled) return false; button.click(); return true; })()`), 'explicit stop');
  }
  if (interrupted) {
    await until(() => heldRequest, 'active request after actual write');
    const before = new DatabaseSync(join(data, 'pi/moos.sqlite'), { readOnly: true });
    let owner, beforeEvents;
    try {
      owner = before.prepare('SELECT tasks.id, tasks.status, projects.path FROM tasks JOIN projects ON projects.id = tasks.projectId ORDER BY tasks.rowid').get();
      assert.equal(owner.status, 'running');
      assert.equal(await readFile(join(owner.path, 'answer.txt'), 'utf8'), '42\n');
      beforeEvents = before.prepare('SELECT type, payload FROM events WHERE taskId = ? ORDER BY id').all(owner.id);
    } finally { before.close(); }
    // Fault only the exact copied-QA descendant tree; never kill by app name,
    // process group shared with this runner, installed path, or global pattern.
    const table = execFileSync('/bin/ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' }).trim().split('\n')
      .map(line => line.trim().split(/\s+/).map(Number));
    const descendants = [];
    function collect(parent) { for (const [pid, ppid] of table) if (ppid === parent) { descendants.push(pid); collect(pid); } }
    collect(child.pid);
    assert.ok(descendants.length > 0, 'owned QA descendants must be observed');
    const hostPids = descendants.filter(pid => {
      try { return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).includes(scratch.split(sep).at(-1) + '/QA.app/Contents/Resources/host-runtime/cli.mjs web --patch '); }
      catch { return false; }
    });
    assert.equal(hostPids.length, 1, 'uniquely bind copied QA Host before fault');
    process.kill(child.pid, 'SIGSTOP');
    for (const pid of descendants.reverse()) {
      try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    child.kill('SIGKILL'); await closed;
    assert.equal(child.signalCode, 'SIGKILL');
    await until(() => heldRequestClosed, 'faulted connection close');
    for (const pid of hostPids) await until(() => {
      try { process.kill(pid, 0); return false; } catch (error) { if (error.code === 'ESRCH') return true; throw error; }
    }, 'faulted owned Host exit');
    socket.close(); lines.close();
    const cold = new DatabaseSync(join(data, 'pi/moos.sqlite'), { readOnly: true });
    try {
      assert.equal(cold.prepare('SELECT status FROM tasks WHERE id = ?').get(owner.id).status, 'running', 'abrupt fault leaves nonterminal task for startup reconciliation');
      assert.deepEqual(cold.prepare('SELECT type, payload FROM events WHERE taskId = ? ORDER BY id').all(owner.id), beforeEvents);
    } finally { cold.close(); }
    const count = requests.length;
    launch(); await connect();
    await until(() => evaluate(`(() => { const el = [...document.querySelectorAll('*')].find(el => el.children.length === 0 && el.textContent.startsWith('Create answer.txt with 42')); el?.click(); return !!el; })()`), 'saved team conversation selected');
    await until(() => evaluate(`!!document.querySelector('[data-composer-input]')`), 'restored composer');
    const restored = new DatabaseSync(join(data, 'pi/moos.sqlite'), { readOnly: true });
    try {
      await until(() => restored.prepare('SELECT status FROM tasks WHERE id = ?').get(owner.id)?.status === 'interrupted', 'startup marks interrupted');
      const afterEvents = restored.prepare('SELECT type, payload FROM events WHERE taskId = ? ORDER BY id').all(owner.id);
      assert.deepEqual(afterEvents.slice(0, beforeEvents.length), beforeEvents, 'startup preserves prior event prefix');
      assert.equal(afterEvents.length, beforeEvents.length + 1);
      const terminal = afterEvents.at(-1);
      assert.equal(terminal.type, 'task_state');
      assert.equal(JSON.parse(terminal.payload).errorCode, 'host_interrupted');
      await sleep(1000);
      assert.equal(requests.length, count, 'restart must not replay model calls');
      assert.equal(restored.prepare('SELECT COUNT(*) AS count FROM tasks').get().count, 1);
      assert.equal(await readFile(join(owner.path, 'answer.txt'), 'utf8'), '42\n');
      report.checks.abruptOwnedQAFaultAndColdRunning = true;
      report.checks.restartMarksInterruptedWithoutReplay = true;
      report.checks.restartPreservesEventPrefixAndArtifact = true;
    } finally { restored.close(); }
  }
  if (shellStop) {
    for (const pid of shellPids) await until(() => {
      try { process.kill(pid, 0); return false; } catch (error) { if (error.code === 'ESRCH') return true; throw error; }
    }, 'actual shell and child exit after UI Stop');
    report.checks.shellAndChildExitedAfterStop = true;
  }
  const terminalLabel = successful ? '已交付' : interrupted ? '已中断' : stopping ? '已停止' : '失败';
  if (successful) await until(() => evaluate(`document.body.innerText.includes('TEAM_GUI_DELIVERED_42')`), 'team delivery');
  await until(() => evaluate(`[...document.querySelectorAll('[data-moos-team-progress]')].some(el => el.textContent.includes(${JSON.stringify(terminalLabel)}))`), 'terminal team progress');
  if (!successful) assert.equal(await evaluate(`document.body.innerText.includes('TEAM_GUI_DELIVERED_42')`), false);
  const nodeText = await evaluate(`[...document.querySelectorAll('[data-moos-team-progress] > ul > li')].map(el => el.textContent)`);
  if (successful) assert.equal(nodeText.filter(text => text.includes('节点已完成')).length, 2);
  if (['blocked', 'retry'].includes(scenario)) assert.ok(nodeText.some(text => text.includes('check') && text.includes('验收阻塞')));
  report.checks.nodeProjection = true;
  async function checkDetails(code) {
    await evaluate(`document.querySelectorAll('[data-moos-pi-process], [data-moos-team-node-details]').forEach(el => el.setAttribute('open',''))`);
    await until(() => evaluate(`!!document.querySelector('[data-moos-team-outcome="${code}"]')`), 'correlated member outcome ' + code);
    const details = await evaluate(`[...document.querySelectorAll('[data-moos-team-node-details]')].map(el => el.innerText).join('\\n')`);
    assert.ok(details.includes('成功工具记录') && details.includes('成功检查记录'));
    if (code === 'verified') assert.ok(details.includes('独立验收通过（已提交结论并有工具证据）'));
    if (code === 'rejected') assert.ok(details.includes('验证成员明确报告未通过'));
    assert.ok(!details.includes('synthetic acceptance blocked') && !details.includes('read confirmed 42'), 'raw verifier prose is not exposed');
    if (scenario === 'blocked') {
      assert.ok(details.includes('未执行：依赖验收阻塞于 check'));
      report.checks.downstreamBlockerDetails = true;
    }
    const layout = await evaluate(`(() => {
      const panel = [...document.querySelectorAll('[data-moos-team-progress]')].find(el => el.querySelector('[data-moos-team-outcome="${code}"]'));
      const bounds = panel.getBoundingClientRect(), style = getComputedStyle(panel);
      return { opaque: !/rgba|transparent/.test(style.backgroundColor),
        rows: [...panel.querySelectorAll('li')].every(el => getComputedStyle(el).display === 'grid'),
        contained: [...panel.querySelectorAll('[data-moos-team-node-details]')].every(el => { const b = el.getBoundingClientRect(); return b.left >= bounds.left && b.right <= bounds.right + 1; }),
        fits: panel.scrollWidth <= panel.clientWidth + 1 };
    })()`);
    assert.ok(Object.values(layout).every(Boolean), 'readable team panel layout: ' + JSON.stringify(layout));
    report.checks.readableMemberLayout = true;
    const usageText = await evaluate(`[...document.querySelectorAll('[data-moos-team-node-details]')].map(el => ({
      id: el.getAttribute('data-moos-team-node-details'), text: el.querySelector('[data-moos-team-usage]')?.innerText }))`);
    for (const node of usageText) {
      assert.ok(node.text?.includes('非完整账单，不估算缺失请求'));
      if (reportedUsage && ['build', 'check'].includes(node.id)) {
        const records = node.id === 'build' ? 2 : 3;
        assert.ok(node.text.includes(records + ' 条记录；输入 ' + records * 10 + '；输出 ' + records * 2 + '；总计 ' + records * 12 + ' token'), node.text);
      } else assert.ok(node.text.includes('成员回复：未报告'), node.text);
      assert.ok(node.text.includes('上下文压缩：未报告'), node.text);
    }
    report.checks.reportedMemberUsageOrExplicitUnknown = true;
    report.memberUsage = { providerReported: reportedUsage, nodes: usageText };

    const fileIndex = await evaluate(`(() => {
      const panel = [...document.querySelectorAll('[data-moos-team-node-details="build"]')].at(-1);
      if (${retrying && code === 'verified'}) return !panel?.querySelector('[data-moos-team-file]')
        && panel?.innerText.includes('暂无可关联的成功 write/edit 记录');
      const button = panel?.querySelector('[data-moos-team-file="answer.txt"]');
      if (!button) return false;
      button.click();
      const row = document.activeElement;
      return row?.hasAttribute('data-moos-action-index')
        && row.closest('[data-moos-pi-process]') === panel.closest('[data-moos-pi-process]')
        && row.innerText.includes('answer.txt') && row.innerText.includes('已完成');
    })()`);
    assert.equal(fileIndex, true, 'member file button focuses its own successful write action');
    report.checks[retrying && code === 'verified' ? 'retriedReadOnlyMemberHasNoInventedFiles' : 'memberFileIndexNavigation'] = true;
    // Dedicated panel image: the navigation screenshot may scroll its heading offscreen.
    if (scenario === 'success') {
      const clip = await evaluate(`(() => {
        const panel = [...document.querySelectorAll('[data-moos-team-progress]')].at(-1);
        panel.scrollIntoView({ block: 'start' });
        const b = panel.getBoundingClientRect();
        return { x: b.x + scrollX, y: b.y + scrollY, width: b.width, height: b.height, scale: 1 };
      })()`);
      await writeFile(join(scratch, 'team-file-panel.png'), Buffer.from((await call('Page.captureScreenshot', { clip, captureBeyondViewport: true })).data, 'base64'));
    }
    report.checks.structuredMemberDetails = true;
  }
  if (!partial) await checkDetails(successful ? 'verified' : 'rejected');
  if (partial) {
    assert.equal(await evaluate(`!!document.querySelector('[data-moos-team-outcome="verified"]')`), false);
    report.checks.noInventedStoppedReceipt = true;
  }
  await capture('team-' + scenario);
  let stoppedSnapshot;
  if (scenario === 'stop-retry' || interrupted) {
    const stoppedDb = new DatabaseSync(join(data, 'pi/moos.sqlite'), { readOnly: true });
    try {
      await until(() => stoppedDb.prepare('SELECT status FROM tasks ORDER BY rowid').get()?.status === (interrupted ? 'interrupted' : 'cancelled'), 'persisted terminal before retry');
      await until(() => heldRequestClosed, 'actual stopped connection close');
      const stopped = stoppedDb.prepare('SELECT tasks.id, projects.path FROM tasks JOIN projects ON projects.id = tasks.projectId ORDER BY tasks.rowid').get();
      assert.equal(await readFile(join(stopped.path, 'answer.txt'), 'utf8'), '42\n');
      stoppedSnapshot = stoppedDb.prepare('SELECT type, payload FROM events WHERE taskId = ? ORDER BY id').all(stopped.id);
      assert.ok(!stoppedSnapshot.some(row => JSON.parse(row.payload).member === 'verifier'));
      const count = requests.length; await sleep(1000);
      assert.equal(requests.length, count, 'stopped team must not automatically replay');
      assert.equal(stoppedDb.prepare('SELECT COUNT(*) AS count FROM tasks').get().count, 1);
      report.checks.stoppedPartialArtifactNoAutoReplay = true;
    } finally { stoppedDb.close(); }
  }
  if (retrying) {
    assert.equal(await evaluate(`!!document.querySelector('[data-moos-team-mode]')`), false);
    await until(() => evaluate(`(() => { const button = document.querySelector('[data-moos-pi-retry] button'); if (!button || button.disabled) return false; button.click(); return true; })()`), 'explicit retry from ordinary composer');
    await until(() => evaluate(`document.body.innerText.includes('TEAM_GUI_DELIVERED_42')`), 'retried team delivery');
    await until(() => evaluate(`[...document.querySelectorAll('[data-moos-team-progress]')].some(el => el.textContent.includes('已交付'))`), 'retried terminal progress');
    assert.equal(await evaluate(`!!document.querySelector('[data-moos-team-mode]')`), false, 'retry must not change future composer mode');
    await until(() => evaluate(`[...document.querySelectorAll('[data-moos-team-progress]')].some(el => el.textContent.includes('已交付') && [...el.querySelectorAll('li')].filter(node => node.textContent.includes('节点已完成')).length === 2)`), 'retried completed nodes');
    await checkDetails('verified');
    await capture('team-retry-delivered');
  }
  if (scenario !== 'attachments') await send('Reply ordinary');
  await until(() => evaluate(`document.body.innerText.includes('ORDINARY_GUI_REPLY')`), 'ordinary response');
  const db = new DatabaseSync(join(data, 'pi/moos.sqlite'), { readOnly: true });
  try {
    const rows = db.prepare(`SELECT tasks.id, tasks.status, projects.path, events.payload FROM tasks JOIN projects ON projects.id = tasks.projectId JOIN events ON events.taskId = tasks.id AND events.type = 'task_submission' ORDER BY tasks.rowid`).all();
    assert.deepEqual(rows.map(row => JSON.parse(row.payload).mode), retrying ? ['team', 'team', 'ordinary'] : ['team', 'ordinary']);
    // Streaming reply can precede the parent task's terminal commit.
    const expected = retrying ? [interrupted ? 'interrupted' : stopping ? 'cancelled' : 'failed', 'succeeded', 'succeeded']
      : [successful ? 'succeeded' : stopping ? 'cancelled' : 'failed', 'succeeded'];
    await until(() => JSON.stringify(db.prepare(`SELECT status FROM tasks ORDER BY rowid`).all().map(row => row.status)) === JSON.stringify(expected), 'persisted terminal tasks');
    const events = db.prepare(`SELECT type, payload FROM events WHERE taskId = ? ORDER BY id`).all(rows[0].id).map(row => ({ type: row.type, payload: JSON.parse(row.payload) }));
    const phases = events.filter(row => row.type === 'team_state').map(row => row.payload.phase);
    if (partial) {
      if (!shellStop) assert.equal(heldRequestClosed, true, 'actual upstream request closed after Stop');
      if (shellStop) {
        assert.ok(events.some(row => row.type === 'tool_start' && row.payload.toolName === 'bash' && row.payload.member === 'implementer'));
        await sleep(1000);
        await assert.rejects(readFile(join(rows[0].path, 'late.txt')), { code: 'ENOENT' });
        report.checks.noPostStopShellWrite = true;
      }
      if (scenario === 'stop') await assert.rejects(readFile(join(rows[0].path, 'answer.txt')), { code: 'ENOENT' });
      else assert.equal(await readFile(join(rows[0].path, 'answer.txt'), 'utf8'), '42\n');
      assert.ok(!events.some(row => row.payload.member === 'verifier'));
      report.checks[interrupted ? 'faultClosesModelConnection' : 'explicitStopCancels'] = true;
    } else {
      assert.equal(await readFile(join(rows[0].path, 'answer.txt'), 'utf8'), '42\n');
      assert.ok(events.some(row => row.type === 'tool_end' && row.payload.member === 'verifier' && row.payload.toolName === 'read'));
      report.checks.independentReadAndArtifact = true;
      report.checks.modeClearDoesNotCancel = true;
    }
    if (!successful) {
      assert.ok(!phases.includes('summarizing') && !phases.includes('succeeded'));
      if (['blocked', 'retry'].includes(scenario)) assert.ok(phases.includes('blocked'));
      report.checks.noFalseDeliveryOrDownstream = true;
    }
    if (retrying) {
      assert.equal(new Set(rows.map(row => row.id)).size, 3);
      assert.deepEqual(db.prepare('SELECT message FROM tasks ORDER BY rowid LIMIT 2').all().map(row => row.message), [originalGoal, originalGoal]);
      const retried = db.prepare('SELECT type, payload FROM events WHERE taskId = ? ORDER BY id').all(rows[1].id)
        .map(row => ({ type: row.type, payload: JSON.parse(row.payload) }));
      assert.equal(retried.find(row => row.type === 'task_retry')?.payload.previousTaskId, rows[0].id);
      const oldAttempts = new Set(events.filter(row => row.type === 'team_state').map(row => row.payload.attemptId).filter(Boolean));
      const newAttempts = retried.filter(row => row.type === 'team_state' && row.payload.phase === 'running');
      assert.equal(newAttempts.length, 4, 'fresh captain planning/summary and both worker turns');
      assert.ok(newAttempts.every(row => row.payload.teamId === rows[1].id && !oldAttempts.has(row.payload.attemptId)));
      assert.deepEqual(roleStarts.map(({ round, role }) => [round, role]), [1, 2].flatMap(round => (partial && round === 1 ? ['captain', 'implementer'] : ['captain', 'implementer', 'verifier']).map(role => [round, role])));
      assert.ok(roleStarts.every(row => !row.priorAssistant), 'retry role contexts must not reuse previous assistant/tool history');
      assert.ok(retried.some(row => row.type === 'tool_end' && row.payload.member === 'captain' && row.payload.toolName === 'read' && !row.payload.isError));
      assert.ok(retried.some(row => row.type === 'tool_end' && row.payload.member === 'implementer' && row.payload.toolName === 'read' && !row.payload.isError));
      assert.ok(retried.some(row => row.type === 'tool_end' && row.payload.member === 'verifier' && row.payload.toolName === 'read' && !row.payload.isError));
      assert.equal(retried.filter(row => row.type === 'team_state' && row.payload.phase === 'completed').length, 2);
      assert.ok(retried.some(row => row.type === 'team_state' && row.payload.phase === 'succeeded'));
      assert.ok(!retried.some(row => row.type === 'tool_start' && row.payload.toolName === 'write'), 'synthetic retry inspects retained artifact instead of rewriting it');
      const owners = db.prepare('SELECT id, conversationId FROM tasks ORDER BY rowid LIMIT 2').all();
      const histories = [];
      for (const owner of owners) for (const role of ['captain', 'implementer', 'verifier']) {
        if (partial && owner.id === rows[0].id && role === 'verifier') continue;
        const prefix = createHash('sha256').update(owner.conversationId + ':' + owner.id).digest('hex').slice(0, 32);
        const directory = join(data, 'pi/sessions', `team-${prefix}-${role}`);
        const files = (await readdir(directory)).filter(file => file.endsWith('.jsonl'));
        assert.equal(files.length, 1, 'one persisted history per task-owned role');
        histories.push(join(directory, files[0]));
      }
      assert.equal(new Set(histories).size, partial ? 5 : 6, 'retry persists separate task-owned role histories');
      if (partial) {
        assert.deepEqual(db.prepare('SELECT type, payload FROM events WHERE taskId = ? ORDER BY id').all(rows[0].id), stoppedSnapshot, 'retry must not mutate or append old task events');
        assert.equal(events.filter(row => row.type === 'tool_start' && row.payload.toolName === 'write').length, 1);
        report.checks.stoppedTaskHistoryUnchanged = true;
      }
      report.checks.retryRetainsModeAndGoal = true;
      report.checks.freshParentAndRoleContexts = true;
      report.checks.artifactInspectedNotRewritten = true;
    }
    if (scenario === 'attachments') {
      assert.equal(await readFile(join(rows[0].path, largeUploadPath), 'utf8'), largeUpload);
      const savedGoal = db.prepare('SELECT message FROM tasks WHERE id = ?').get(rows[0].id).message;
      assert.ok(savedGoal.includes('UPLOAD_INLINE_42') && savedGoal.includes(largeUploadPath));
      assert.ok(!savedGoal.includes(largeUpload), 'large upload is a workspace reference, not inlined');
      assert.ok(requests.some(body => body.tools?.some(item => item.function.name === 'team_plan') && body.messages.some(message => message.role === 'tool' && JSON.stringify(message.content).includes('UPLOAD_LARGE_42'))));
      assert.ok(events.some(row => row.type === 'tool_end' && row.payload.member === 'implementer' && row.payload.toolName === 'read' && !row.payload.isError));
      assert.ok(db.prepare('SELECT message FROM tasks WHERE id = ?').get(rows[1].id).message.includes('QUEUE_ATTACHMENT_42'));
      assert.equal(await evaluate(`!!document.querySelector('[data-moos-team-mode]')`), true, 'later selection stays team while queued task remains ordinary');
      report.checks.uploadBytesAndCaptainMemberReads = true;
      report.checks.queuedModeImmutableAfterFutureSelection = true;
    }
    report.checks.persistedTerminalState = true;
    report.checks.ordinaryAfterClear = true;
  } finally { db.close(); }
  if (historyReload) {
    const historyDb = new DatabaseSync(join(data, 'pi/moos.sqlite'), { readOnly: true });
    try {
      const snapshot = () => ({
        tasks: historyDb.prepare('SELECT id, status, message FROM tasks ORDER BY rowid').all(),
        events: historyDb.prepare('SELECT id, taskId, type, payload FROM events ORDER BY id').all(),
      });
      const before = snapshot(), count = requests.length;
      const projection = async () => evaluate(`(() => {
        document.querySelectorAll('[data-moos-pi-process], [data-moos-team-node-details]').forEach(el => el.setAttribute('open', ''));
        return [...document.querySelectorAll('[data-moos-team-progress]')].map(el => ({
          text: el.innerText,
          files: [...el.querySelectorAll('[data-moos-team-file]')].map(file => file.getAttribute('data-moos-team-file')),
          outcomes: [...el.querySelectorAll('[data-moos-team-outcome]')].map(receipt => receipt.getAttribute('data-moos-team-outcome')),
          blockers: [...el.querySelectorAll('[data-moos-team-blocker]')].map(blocker => blocker.textContent),
        }));
      })()`);
      const original = await projection();
      assert.equal(original.length, 1, 'bind one completed team panel before reload');
      assert.deepEqual(original[0].files, ['answer.txt']);
      await call('Page.reload', { ignoreCache: true });
      // The same CDP target survives renderer reload; no application quit/relaunch.
      await until(() => evaluate(`(() => { const el = [...document.querySelectorAll('*')].find(el => el.children.length === 0 && el.textContent.startsWith('Create answer.txt with 42')); el?.click(); return !!el; })()`), 'reloaded saved team conversation');
      await until(async () => JSON.stringify(await projection()) === JSON.stringify(original), 'restored identical member projection');
      await checkDetails(successful ? 'verified' : 'rejected');
      assert.equal(await evaluate(`!!document.querySelector('[data-moos-team-mode]')`), false, 'historical team must not select future team mode');
      const restoreRetry = await evaluate(`!!document.querySelector('[data-moos-pi-retry] button')`);
      assert.equal(restoreRetry, false, 'latest ordinary success must not manufacture a retry control');
      await sleep(1000);
      assert.deepEqual(snapshot(), before, 'renderer reload must not append or mutate settled tasks/events');
      assert.equal(requests.length, count, 'renderer reload must not replay model requests');
      const project = historyDb.prepare('SELECT projects.path FROM projects JOIN tasks ON tasks.projectId = projects.id ORDER BY tasks.rowid LIMIT 1').get();
      assert.equal(await readFile(join(project.path, 'answer.txt'), 'utf8'), '42\n');
      report.checks.historyReloadRestoresMemberProjection = true;
      report.checks.historyReloadFileNavigation = true;
      report.checks.historyReloadNoModelReplayOrEventMutation = true;
      report.checks.historyReloadDoesNotRestoreComposerMode = true;
      report.historyReload = { observationMs: 1000, taskCount: before.tasks.length, eventCount: before.events.length,
        modelRequestsBefore: count, modelRequestsAfter: requests.length, projectionEqual: true,
        tasksAndEventsEqual: true, appRelaunched: false };
      await capture('team-history-reloaded');
      const clip = await evaluate(`(() => {
        const panel = document.querySelector('[data-moos-team-progress]');
        panel.scrollIntoView({ block: 'start' });
        const b = panel.getBoundingClientRect();
        return { x: b.x + scrollX, y: b.y + scrollY, width: b.width, height: b.height, scale: 1 };
      })()`);
      await writeFile(join(scratch, 'team-history-panel.png'), Buffer.from((await call('Page.captureScreenshot', { clip, captureBeyondViewport: true })).data, 'base64'));
    } finally { historyDb.close(); }
  }
  assert.deepEqual(errors, []);
  report.status = 'passed'; report.requests = requests.length;
  // Closing the last window can terminate Electron before CDP acknowledges
  // Page.close. A normal child exit is authoritative, not a lost CDP reply.
  report.shutdown = { injectedQuitBlock: blockQuit, requestedAt: Date.now(), events: shutdownEvents,
    beforeClose: await snapshotQaProcesses(child.pid) };
  await Promise.race([call('Page.close'), closed]);
  await Promise.race([closed, sleep(10000)]);
  report.shutdown.observedAt = Date.now();
  report.shutdown.exitCode = child.exitCode;
  assert.equal(child.exitCode, 0, 'normal QA quit');
} catch (error) {
  report.status = 'failed'; report.error = error.message;
  if (report.shutdown) {
    report.shutdown.failureAt = Date.now();
    report.shutdown.failureProcesses = await snapshotQaProcesses(child.pid);
    report.shutdown.exitCode = child.exitCode;
  }
  throw error;
}
finally {
  await writeFile(join(scratch, 'report.json'), JSON.stringify(report, null, 2)); console.log(scratch, JSON.stringify(report));
  socket?.close(); lines.close(); server.closeAllConnections(); server.close();
  if (child.exitCode === null) { child.kill('SIGTERM'); await Promise.race([closed, sleep(5000)]); }
}
