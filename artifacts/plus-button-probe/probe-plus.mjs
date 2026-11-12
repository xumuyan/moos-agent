// Explicit isolated Electron probe; never targets the installed Moos or user data.
// Question (user, 2026-11-12): does the composer "+" button (left of the input)
// actually do anything, like the removed permission menu didn't?
// Method: click "+" in an isolated 0.1.48 candidate build with CDP
// Page.setInterceptFileChooserDialog enabled; if the button drives the real
// upload flow, Page.fileChooserOpened fires (no native dialog needed). Also
// capture any popover menu labels and the button's DOM identity.
// Usage: node probe-plus.mjs <build.app> <output-parent>
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createInterface } from 'node:readline';
import { startFixture } from 'file:///Users/xuguopeng/Documents/%E5%BE%90%E9%83%AD%E9%B9%8F%E9%A1%B9%E7%9B%AE/%E5%BE%90-moos-agent/services/agent/fixture.mjs';
import { checkedProvider } from 'file:///Users/xuguopeng/Documents/%E5%BE%90%E9%83%AD%E9%B9%8F%E9%A1%B9%E7%9B%AE/%E5%BE%90-moos-agent/packages/pi-adapter/index.mjs';
import { piModels } from 'file:///Users/xuguopeng/Documents/%E5%BE%90%E9%83%AD%E9%B9%8F%E9%A1%B9%E7%9B%AE/%E5%BE%90-moos-agent/apps/electron/plugin/pi-models.js';
import { seedHome } from 'file:///Users/xuguopeng/Documents/%E5%BE%90%E9%83%AD%E9%B9%8F%E9%A1%B9%E7%9B%AE/%E5%BE%90-moos-agent/apps/electron/profile-home.mjs';

const [buildPath, output] = process.argv.slice(2);
if (!buildPath || !output) throw new Error('Usage: node probe-plus.mjs <build.app> <output-parent>');
const repo = '/Users/xuguopeng/Documents/徐郭鹏项目/徐-moos-agent';
const allowedBuild = resolve(repo, '.generated/moos-electron') + sep;
if (!resolve(buildPath).startsWith(allowedBuild) || !(await realpath(buildPath)).startsWith(allowedBuild)) {
  throw new Error('Only repository-isolated build paths are accepted');
}
if (!resolve(output).startsWith(resolve(repo, 'artifacts') + sep)) throw new Error('Output must be inside repository artifacts');
await mkdir(resolve(output), { recursive: true });
const scratch = await mkdtemp(join(resolve(output), 'recovery-'));
const instance = join(scratch, 'probe');
await mkdir(instance, { recursive: true });

const relay = await startFixture({ desktopPolicy: true });

const app = join(instance, 'Moos.app');
execFileSync('/usr/bin/ditto', [resolve(buildPath), app]);
const resources = join(app, 'Contents/Resources');
const shellVersion = JSON.parse(await readFile(join(resources, 'profile-template/profiles/web/node_modules/moos-electron-shell/package.json'), 'utf8')).version;
const entry = join(resources, 'app/main.mjs');
await writeFile(entry, (await readFile(entry, 'utf8')).replace("app.setName('Moos');", "BrowserWindow.prototype.show = function () {};\napp.setName('Moos');"));
execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'ignore' });
const data = join(instance, 'data');
await seedHome(resources, join(data, 'dsh'));
await piModels(data, checkedProvider).save({ id: 'plus-fixture', name: '加号按钮隔离验收', model: 'moos-fixture',
  baseUrl: relay.baseUrl, service: 'openai', api: 'openai-completions', apiKey: relay.apiKey });

const macosDir = join(app, 'Contents/MacOS');
const [executable] = (await readdir(macosDir)).filter(name => !name.startsWith('_'));
const child = spawn(join(macosDir, executable), ['--remote-debugging-port=0'], {
  env: { ...process.env, MOOS_ELECTRON_DATA: data }, stdio: ['ignore', 'ignore', 'pipe'],
});
const closed = new Promise(r => child.once('exit', r));
let port;
const lines = createInterface({ input: child.stderr });
lines.on('line', line => { const m = line.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/); if (m) port = m[1]; });
for (let i = 0; i < 240 && !port; i++) { await sleep(250); if (child.exitCode !== null) break; }
if (!port) throw new Error('no debug port');

let target;
let socket;
let seq = 0;
const pending = new Map();
const events = [];
const call = (method, params = {}) => new Promise((r, j) => {
  const id = ++seq;
  const timer = setTimeout(() => { pending.delete(id); j(new Error('CDP timeout')); }, 15000);
  pending.set(id, response => { clearTimeout(timer); pending.delete(id); response.error ? j(new Error(response.error.message)) : r(response.result); });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error('page evaluation failed: ' + JSON.stringify(result.exceptionDetails).slice(0, 300));
  return result.result.value;
};

try {
  for (let i = 0; i < 240; i++) {
    const list = await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json()).catch(() => []);
    target = list.find(row => row.url.startsWith('http://127.0.0.1:'));
    if (target) break;
    if (child.exitCode !== null) break;
    await sleep(250);
  }
  if (!target) throw new Error('workbench page not found');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { socket.addEventListener('open', r, { once: true }); socket.addEventListener('error', j, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) { pending.get(message.id)?.(message); return; }
    if (message.method) events.push({ method: message.method, params: message.params });
  });
  let ready = false;
  for (let i = 0; i < 240; i++) {
    const state = await evaluate(`!!document.querySelector('[data-composer-input]')`).catch(() => false);
    if (state) { ready = true; break; }
    if (child.exitCode !== null) break;
    await sleep(250);
  }
  if (!ready) throw new Error('composer never ready');
  await sleep(3000); // locale + composer bottom bar mount after the input element

  await call('Page.enable');
  await call('Page.setInterceptFileChooserDialog', { enabled: true });
  const textBefore = await evaluate(`document.body.textContent.length`);

  const plusInfo = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')].filter(b => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    const plus = buttons.filter(b => {
      const aria = b.getAttribute('aria-label') || '';
      return (b.textContent || '').trim() === '+' || /添加文件|上传|附件|attach|upload/i.test(aria);
    }).map(b => ({
      text: (b.textContent || '').trim().slice(0, 20),
      aria: b.getAttribute('aria-label'),
      cls: String(b.className).slice(0, 60),
      x: Math.round(b.getBoundingClientRect().x),
      y: Math.round(b.getBoundingClientRect().y),
    }));
    return { plus, buttonsTotal: buttons.length };
  })()`);
  assert.ok(plusInfo.plus.length > 0, 'plus button not found in composer');
  const clickTarget = plusInfo.plus[0];
  events.length = 0;
  await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')];
    const b = buttons.find(x => {
      const t = (x.textContent || '').trim();
      const aria = x.getAttribute('aria-label') || '';
      return (t === '+' || /上传|添加|附件|attach|upload|plus/i.test(aria + ' ' + String(x.className)))
        && Math.round(x.getBoundingClientRect().x) === ${clickTarget.x} && Math.round(x.getBoundingClientRect().y) === ${clickTarget.y};
    });
    b?.click();
    return !!b;
  })()`);
  await sleep(2000);
  const after = await evaluate(`(() => {
    const tc = document.body.textContent || '';
    const uploadWords = ['上传', '选择文件', '添加图片', '附件', '本地文件', '图片'].filter(w => tc.includes(w));
    const popovers = [...document.querySelectorAll('[role=menu], [role=dialog], [role=listbox], [class*=menu], [class*=popover], [class*=Menu], [class*=Popover]')]
      .map(el => ({ tag: el.tagName, cls: String(el.className).slice(0, 60), text: (el.textContent || '').trim().slice(0, 120) }))
      .filter(el => el.text);
    return { uploadWords, popovers, textLen: tc.length };
  })()`);
  const chooserEvents = events.filter(e => e.method === 'Page.fileChooserOpened');
  const screenshot = await call('Page.captureScreenshot');
  await writeFile(join(instance, 'plus-after.png'), Buffer.from(screenshot.data, 'base64'));

  const report = {
    time: new Date().toISOString(),
    shellVersion,
    plusButton: clickTarget,
    plusCandidates: plusInfo.plus,
    fileChooserOpened: chooserEvents.length > 0,
    chooserEvents: chooserEvents.map(e => ({ mode: e.params.mode, backendNodeId: !!e.params.backendNodeId })),
    menuAfterClick: after,
    textBefore,
    screenshot: join(instance, 'plus-after.png'),
    dir: instance,
  };
  await writeFile(join(scratch, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await call('Page.close').catch(() => {});
  await Promise.race([closed, sleep(5000)]);
  if (child.exitCode === null) child.kill('SIGTERM');
  await Promise.race([closed, sleep(5000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
  if (report.fileChooserOpened) console.log('PLUS-OPENS-FILE-CHOOSER OK');
  else if (after.popovers.length > 0) console.log('PLUS-OPENS-MENU OK');
  else console.log('PLUS-NO-VISIBLE-REACTION');
} catch (error) {
  if (child.exitCode === null) child.kill('SIGKILL');
  await Promise.race([closed, sleep(3000)]);
  throw error;
} finally {
  lines.close();
  socket?.close();
  await rm(join(instance, 'Moos.app'), { recursive: true, force: true }).catch(() => {});
  await rm(join(instance, 'data'), { recursive: true, force: true }).catch(() => {});
  await relay.close().catch(() => {});
}
