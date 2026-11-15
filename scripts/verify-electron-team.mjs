// Isolated hidden-window renderer/Host/PI acceptance. Not normal desktop-input QA.
import assert from 'node:assert/strict';
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
assert.ok(['success', 'blocked', 'stop', 'retry'].includes(scenario), 'Unsupported QA scenario');
const repo = process.cwd(), allowed = join(repo, '.generated/moos-electron') + sep;
assert.ok(resolve(inputApp).startsWith(allowed) && (await realpath(inputApp)).startsWith(allowed));
const scratch = await mkdtemp(join(repo, 'artifacts/team-ui/gui-'));
const app = join(scratch, 'QA.app');
execFileSync('/usr/bin/ditto', [resolve(inputApp), app]);
const resources = join(app, 'Contents/Resources'), entry = join(resources, 'app/main.mjs');
let main = await readFile(entry, 'utf8');
assert.ok(main.includes("app.setName('沐码');"));
await writeFile(entry, main.replace("app.setName('沐码');", "BrowserWindow.prototype.show = function () {};\napp.setName('沐码');"));
execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'ignore' });
const data = join(scratch, 'data'); await seedHome(resources, join(data, 'dsh'));
const errors = [], requests = [];
let heldRequest = false, heldRequestClosed = false, planningRounds = 0;
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
    const retryRound = scenario === 'retry' && planningRounds === 2;
    if (prompt.includes('只根据已有工具/成员证据')) content = 'TEAM_GUI_DELIVERED_42';
    else if (planning) {
      if (retryRound) {
        assert.ok(prompt.includes(originalGoal) && prompt.includes('这是用户显式重试的团队任务'));
        assert.ok(prompt.includes('禁止盲目重复安装、提交、发送或部署'));
      }
      if (retryRound && !latest) { name = 'read'; args = { path: 'answer.txt' }; }
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
      if (latest) { if (retryRound) assert.ok(latest.content.includes('42')); content = 'written'; }
      else if (retryRound) { name = 'read'; args = { path: 'answer.txt' }; }
      else { name = 'write'; args = { path: 'answer.txt', content: '42\n' }; }
    } else content = 'ORDINARY_GUI_REPLY';
    // Hold an actual implementer request until the UI Stop cancels it.
    // No write tool has been returned; an incorrectly uncancelled request times out.
    if (scenario === 'stop' && prompt.includes('当前任务build') && !latest) {
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
    res.end('data: [DONE]\n\n');
  } catch (error) { errors.push(error.message); res.writeHead(500); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
await piModels(data, checkedProvider).save({ id: 'gui', model: 'fixture-model', api: 'openai-completions',
  baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'synthetic-local-only' });
const env = { ...process.env, TMPDIR: '/private/tmp/' };
for (const key of Object.keys(env)) if (key.startsWith('MOOS_ELECTRON_') || key.startsWith('DSH_') || ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH'].includes(key)) delete env[key];
env.MOOS_ELECTRON_DATA = data;
const child = spawn(join(app, 'Contents/MacOS/MuMa'), ['--remote-debugging-port=0'], { env, stdio: ['ignore', 'ignore', 'pipe'] });
const closed = new Promise(r => child.once('exit', r));
const lines = createInterface({ input: child.stderr }); let port, socket;
lines.on('line', line => { const m = line.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/); if (m) port = m[1]; void appendFile(join(scratch, 'app.log'), line + '\n'); });
async function until(fn, label) {
  for (let i = 0; i < 240; i++) { const result = await fn(); if (result) return result; if (child.exitCode !== null) break; await sleep(250); }
  throw new Error('Missing ' + label);
}
const report = { scenario, scope: 'isolated copied QA bundle with show suppressed; CDP input; synthetic local model', checks: {}, productionTouched: false, normalGUI: false, externalModel: false };
try {
  await until(async () => port, 'debug port');
  const target = await until(async () => (await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json())).find(row => row.url.startsWith('http://127.0.0.1:')), 'workbench');
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => socket.addEventListener('open', r, { once: true }));
  let seq = 0; const pending = new Map();
  socket.addEventListener('message', event => { const result = JSON.parse(event.data); pending.get(result.id)?.(result); });
  const call = (method, params = {}) => new Promise((r, j) => {
    const id = ++seq, timer = setTimeout(() => { pending.delete(id); j(new Error('CDP timeout')); }, 15000);
    pending.set(id, response => { clearTimeout(timer); pending.delete(id); response.error ? j(new Error(response.error.message)) : r(response.result); });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  const capture = async name => writeFile(join(scratch, name + '.png'), Buffer.from((await call('Page.captureScreenshot')).data, 'base64'));
  await until(() => evaluate(`(() => { const el = document.querySelector('[data-composer-input]'); if (!el) return false; if (el.dataset.phase === 'inert') { el.click(); return false; } return el.contentEditable === 'true'; })()`), 'active composer');
  await sleep(1200);
  await evaluate(`(() => { const cancel = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === '取消'); cancel?.click(); })()`);
  await until(() => evaluate(`(() => { const button = document.querySelector('button[aria-label="添加文件或调用指令"]'); if (!button) return false; button.click(); return true; })()`), 'plus menu');
  await until(() => evaluate(`(() => { const el = [...document.querySelectorAll('[role="menuitem"], [role="option"], button')].find(el => el.textContent.trim().startsWith('团队协作')); if (!el) return false; el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); return true; })()`), 'team menu action');
  await until(() => evaluate(`!!document.querySelector('[data-moos-team-mode]')`), 'team tag');
  await capture('team-selected'); report.checks.menuAndTag = true;
  async function send(text) {
    await evaluate(`document.querySelector('[data-composer-input]').focus()`);
    await call('Input.insertText', { text });
    await until(() => evaluate(`(() => { const button = document.querySelector('button[aria-label="发送消息"]'); if (!button || button.disabled) return false; button.click(); return true; })()`), 'send');
  }
  await send(originalGoal);
  await until(() => evaluate(`!!document.querySelector('[data-moos-team-progress]')`), 'live team progress');
  await evaluate(`document.querySelector('[data-moos-pi-process]')?.setAttribute('open','')`);
  await capture('team-live'); report.checks.liveProgress = true;
  await evaluate(`document.querySelector('[aria-label="退出团队模式（不停止任务）"]').click()`);
  await until(() => evaluate(`!document.querySelector('[data-moos-team-mode]')`), 'tag cleared');
  if (scenario === 'stop') {
    await until(() => heldRequest, 'active implementer model request');
    await until(() => evaluate(`(() => { const button = document.querySelector('button[aria-label="停止生成"]'); if (!button || button.disabled) return false; button.click(); return true; })()`), 'explicit stop');
  }
  const terminalLabel = scenario === 'success' ? '已交付' : scenario === 'stop' ? '已停止' : '失败';
  if (scenario === 'success') await until(() => evaluate(`document.body.innerText.includes('TEAM_GUI_DELIVERED_42')`), 'team delivery');
  await until(() => evaluate(`[...document.querySelectorAll('[data-moos-team-progress]')].some(el => el.textContent.includes(${JSON.stringify(terminalLabel)}))`), 'terminal team progress');
  if (scenario !== 'success') assert.equal(await evaluate(`document.body.innerText.includes('TEAM_GUI_DELIVERED_42')`), false);
  const nodeText = await evaluate(`[...document.querySelectorAll('[data-moos-team-progress] li')].map(el => el.textContent)`);
  if (scenario === 'success') assert.equal(nodeText.filter(text => text.includes('节点已完成')).length, 2);
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
    report.checks.structuredMemberDetails = true;
  }
  if (scenario !== 'stop') await checkDetails(scenario === 'success' ? 'verified' : 'rejected');
  if (scenario === 'stop') {
    assert.equal(await evaluate(`!!document.querySelector('[data-moos-team-outcome="verified"]')`), false);
    report.checks.noInventedStoppedReceipt = true;
  }
  await capture('team-' + scenario);
  if (scenario === 'retry') {
    assert.equal(await evaluate(`!!document.querySelector('[data-moos-team-mode]')`), false);
    await until(() => evaluate(`(() => { const button = document.querySelector('[data-moos-pi-retry] button'); if (!button || button.disabled) return false; button.click(); return true; })()`), 'explicit retry from ordinary composer');
    await until(() => evaluate(`document.body.innerText.includes('TEAM_GUI_DELIVERED_42')`), 'retried team delivery');
    await until(() => evaluate(`[...document.querySelectorAll('[data-moos-team-progress]')].some(el => el.textContent.includes('已交付'))`), 'retried terminal progress');
    assert.equal(await evaluate(`!!document.querySelector('[data-moos-team-mode]')`), false, 'retry must not change future composer mode');
    await until(() => evaluate(`[...document.querySelectorAll('[data-moos-team-progress]')].some(el => el.textContent.includes('已交付') && [...el.querySelectorAll('li')].filter(node => node.textContent.includes('节点已完成')).length === 2)`), 'retried completed nodes');
    await checkDetails('verified');
    await capture('team-retry-delivered');
  }
  await send('Reply ordinary');
  await until(() => evaluate(`document.body.innerText.includes('ORDINARY_GUI_REPLY')`), 'ordinary response');
  const db = new DatabaseSync(join(data, 'pi/moos.sqlite'), { readOnly: true });
  try {
    const rows = db.prepare(`SELECT tasks.id, tasks.status, projects.path, events.payload FROM tasks JOIN projects ON projects.id = tasks.projectId JOIN events ON events.taskId = tasks.id AND events.type = 'task_submission' ORDER BY tasks.rowid`).all();
    assert.deepEqual(rows.map(row => JSON.parse(row.payload).mode), scenario === 'retry' ? ['team', 'team', 'ordinary'] : ['team', 'ordinary']);
    // Streaming reply can precede the parent task's terminal commit.
    const expected = scenario === 'retry' ? ['failed', 'succeeded', 'succeeded']
      : [scenario === 'success' ? 'succeeded' : scenario === 'stop' ? 'cancelled' : 'failed', 'succeeded'];
    await until(() => JSON.stringify(db.prepare(`SELECT status FROM tasks ORDER BY rowid`).all().map(row => row.status)) === JSON.stringify(expected), 'persisted terminal tasks');
    const events = db.prepare(`SELECT type, payload FROM events WHERE taskId = ? ORDER BY id`).all(rows[0].id).map(row => ({ type: row.type, payload: JSON.parse(row.payload) }));
    const phases = events.filter(row => row.type === 'team_state').map(row => row.payload.phase);
    if (scenario === 'stop') {
      assert.equal(heldRequestClosed, true, 'actual upstream request closed after Stop');
      await assert.rejects(readFile(join(rows[0].path, 'answer.txt')), { code: 'ENOENT' });
      assert.ok(!events.some(row => row.payload.member === 'verifier'));
      report.checks.explicitStopCancels = true;
    } else {
      assert.equal(await readFile(join(rows[0].path, 'answer.txt'), 'utf8'), '42\n');
      assert.ok(events.some(row => row.type === 'tool_end' && row.payload.member === 'verifier' && row.payload.toolName === 'read'));
      report.checks.independentReadAndArtifact = true;
      report.checks.modeClearDoesNotCancel = true;
    }
    if (scenario !== 'success') {
      assert.ok(!phases.includes('summarizing') && !phases.includes('succeeded'));
      if (['blocked', 'retry'].includes(scenario)) assert.ok(phases.includes('blocked'));
      report.checks.noFalseDeliveryOrDownstream = true;
    }
    if (scenario === 'retry') {
      assert.equal(new Set(rows.map(row => row.id)).size, 3);
      assert.deepEqual(db.prepare('SELECT message FROM tasks ORDER BY rowid LIMIT 2').all().map(row => row.message), [originalGoal, originalGoal]);
      const retried = db.prepare('SELECT type, payload FROM events WHERE taskId = ? ORDER BY id').all(rows[1].id)
        .map(row => ({ type: row.type, payload: JSON.parse(row.payload) }));
      assert.equal(retried.find(row => row.type === 'task_retry')?.payload.previousTaskId, rows[0].id);
      const oldAttempts = new Set(events.filter(row => row.type === 'team_state').map(row => row.payload.attemptId).filter(Boolean));
      const newAttempts = retried.filter(row => row.type === 'team_state' && row.payload.phase === 'running');
      assert.equal(newAttempts.length, 4, 'fresh captain planning/summary and both worker turns');
      assert.ok(newAttempts.every(row => row.payload.teamId === rows[1].id && !oldAttempts.has(row.payload.attemptId)));
      assert.deepEqual(roleStarts.map(({ round, role }) => [round, role]), [1, 2].flatMap(round => ['captain', 'implementer', 'verifier'].map(role => [round, role])));
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
        const prefix = createHash('sha256').update(owner.conversationId + ':' + owner.id).digest('hex').slice(0, 32);
        const directory = join(data, 'pi/sessions', `team-${prefix}-${role}`);
        const files = (await readdir(directory)).filter(file => file.endsWith('.jsonl'));
        assert.equal(files.length, 1, 'one persisted history per task-owned role');
        histories.push(join(directory, files[0]));
      }
      assert.equal(new Set(histories).size, 6, 'retry persists separate task-owned role histories');
      report.checks.retryRetainsModeAndGoal = true;
      report.checks.freshParentAndRoleContexts = true;
      report.checks.artifactInspectedNotRewritten = true;
    }
    report.checks.persistedTerminalState = true;
    report.checks.ordinaryAfterClear = true;
  } finally { db.close(); }
  assert.deepEqual(errors, []);
  report.status = 'passed'; report.requests = requests.length;
  // Closing the last window can terminate Electron before CDP acknowledges
  // Page.close. A normal child exit is authoritative, not a lost CDP reply.
  await Promise.race([call('Page.close'), closed]);
  await Promise.race([closed, sleep(10000)]);
  assert.equal(child.exitCode, 0, 'normal QA quit');
} catch (error) { report.status = 'failed'; report.error = error.message; throw error; }
finally {
  await writeFile(join(scratch, 'report.json'), JSON.stringify(report, null, 2)); console.log(scratch, JSON.stringify(report));
  socket?.close(); lines.close(); server.closeAllConnections(); server.close();
  if (child.exitCode === null) { child.kill('SIGTERM'); await Promise.race([closed, sleep(5000)]); }
}
