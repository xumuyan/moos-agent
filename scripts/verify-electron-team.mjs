// Isolated hidden-window renderer/Host/PI acceptance. Not normal desktop-input QA.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, writeFile, appendFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { checkedProvider } from '../packages/pi-adapter/index.mjs';
import { piModels } from '../apps/electron/plugin/pi-models.js';
import { seedHome } from '../apps/electron/profile-home.mjs';
const [inputApp] = process.argv.slice(2);
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
const server = createServer(async (req, res) => {
  try {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    const user = body.messages.filter(item => item.role === 'user').at(-1);
    const prompt = typeof user.content === 'string' ? user.content : user.content.map(part => part.text ?? '').join('');
    const names = body.tools?.map(item => item.function.name) ?? [];
    const latest = body.messages.at(-1).role === 'tool' ? body.messages.at(-1) : undefined;
    let name, args, content;
    if (prompt.includes('只根据已有工具/成员证据')) content = 'TEAM_GUI_DELIVERED_42';
    else if (names.includes('team_plan')) {
      if (latest) content = 'planned'; else { name = 'team_plan'; args = { tasks: [
        { id: 'build', role: 'implementer', goal: 'Write answer.txt as 42', dependsOn: [] },
        { id: 'check', role: 'verifier', goal: 'Read answer.txt and verify 42', dependsOn: ['build'] },
      ] }; }
    } else if (names.includes('team_verdict')) {
      if (!latest) { name = 'read'; args = { path: 'answer.txt' }; }
      else if (latest.name === 'read' || latest.content.includes('42')) {
        assert.ok(latest.content.includes('42')); name = 'team_verdict'; args = { passed: true, summary: 'read confirmed 42' };
      } else content = 'verified';
    } else if (prompt.includes('当前任务build')) {
      if (latest) content = 'written'; else { name = 'write'; args = { path: 'answer.txt', content: '42\n' }; }
    } else content = 'ORDINARY_GUI_REPLY';
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
const report = { scope: 'isolated copied QA bundle with show suppressed; CDP input; synthetic local model', checks: {}, productionTouched: false, normalGUI: false, externalModel: false };
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
  await send('Create answer.txt with 42 and independently verify it');
  await until(() => evaluate(`!!document.querySelector('[data-moos-team-progress]')`), 'live team progress');
  await evaluate(`document.querySelector('[data-moos-pi-process]')?.setAttribute('open','')`);
  await capture('team-live'); report.checks.liveProgress = true;
  await evaluate(`document.querySelector('[aria-label="退出团队模式（不停止任务）"]').click()`);
  await until(() => evaluate(`!document.querySelector('[data-moos-team-mode]')`), 'tag cleared');
  await until(() => evaluate(`document.body.innerText.includes('TEAM_GUI_DELIVERED_42')`), 'team delivery');
  await until(() => evaluate(`[...document.querySelectorAll('[data-moos-team-progress]')].some(el => el.textContent.includes('已交付') && el.textContent.includes('独立验证成员'))`), 'completed team progress');
  await capture('team-delivered');
  await send('Reply ordinary');
  await until(() => evaluate(`document.body.innerText.includes('ORDINARY_GUI_REPLY')`), 'ordinary response');
  const db = new DatabaseSync(join(data, 'pi/moos.sqlite'), { readOnly: true });
  try {
    const rows = db.prepare(`SELECT tasks.id, tasks.status, projects.path, events.payload FROM tasks JOIN projects ON projects.id = tasks.projectId JOIN events ON events.taskId = tasks.id AND events.type = 'task_submission' ORDER BY tasks.rowid`).all();
    assert.deepEqual(rows.map(row => JSON.parse(row.payload).mode), ['team', 'ordinary']);
    // Streaming reply can precede the parent task's terminal commit.
    await until(() => db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE status = 'succeeded'`).get().n === 2, 'persisted successful tasks');
    assert.ok(db.prepare(`SELECT status FROM tasks`).all().every(row => row.status === 'succeeded'));
    assert.equal(await readFile(join(rows[0].path, 'answer.txt'), 'utf8'), '42\n');
    assert.ok(db.prepare(`SELECT COUNT(*) AS n FROM events WHERE taskId = ? AND type = 'tool_end' AND json_extract(payload, '$.member') = 'verifier' AND json_extract(payload, '$.toolName') = 'read'`).get(rows[0].id).n > 0);
    report.checks.modeClearDoesNotCancel = true; report.checks.independentReadAndArtifact = true;
    report.checks.ordinaryAfterClear = true;
  } finally { db.close(); }
  assert.deepEqual(errors, []);
  report.status = 'passed'; report.requests = requests.length;
  await call('Page.close'); await Promise.race([closed, sleep(10000)]);
  assert.notEqual(child.exitCode, null, 'normal QA quit');
} catch (error) { report.status = 'failed'; report.error = error.message; throw error; }
finally {
  await writeFile(join(scratch, 'report.json'), JSON.stringify(report, null, 2)); console.log(scratch, JSON.stringify(report));
  socket?.close(); lines.close(); server.closeAllConnections(); server.close();
  if (child.exitCode === null) { child.kill('SIGTERM'); await Promise.race([closed, sleep(5000)]); }
}
