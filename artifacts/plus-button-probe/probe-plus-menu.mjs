// Explicit isolated Electron probe; never targets the installed Moos or user data.
// Follow-up to E134: the composer "+" (添加文件或调用指令) opens a five-item
// session command menu (添加文件/反馈/指令权限/模型/下载日志). Probe each item:
// click it, collect CDP events (file chooser, downloads, new dialogs/popovers),
// then Escape back to a clean composer before the next item.
// Usage: node probe-plus-menu.mjs <build.app> <output-parent> [--only <label>]
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

const args = process.argv.slice(2);
const [buildPath, output] = args;
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
if (!buildPath || !output) throw new Error('Usage: node probe-plus-menu.mjs <build.app> <output-parent> [--only label]');
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
await piModels(data, checkedProvider).save({ id: 'plus-fixture', name: '加号菜单隔离验收', model: 'moos-fixture',
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
  let target;
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
    if (message.method) events.push(message.method);
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
  await call('Browser.enable').catch(() => {});

  const clickAt = async (x, y) => {
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await sleep(120);
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sleep(80);
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };

  const MENU_ITEMS = ['文件', '反馈', '权限', '模型', '下载日志'];
  const results = [];
  for (const label of (only ? [only] : MENU_ITEMS)) {
    events.length = 0;
    const plusRect = await evaluate(`(() => {
      const plus = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '') === '添加文件或调用指令');
      if (!plus) return null;
      const r = plus.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`);
    assert.ok(plusRect, label + ': plus button missing');
    await clickAt(plusRect.x, plusRect.y);
    await sleep(700);
    const itemRect = await evaluate(`(() => {
      const items = [...document.querySelectorAll('button[role=option]')].filter(b => {
        const name = b.querySelector('[class*=itemName]');
        return name && (name.textContent || '').trim() === ${JSON.stringify(label)};
      });
      const el = items[0];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + Math.min(r.width / 2, 120)), y: Math.round(r.y + r.height / 2) };
    })()`);
    if (!itemRect) { results.push({ label, error: 'menu item not found' }); continue; }
    await clickAt(itemRect.x, itemRect.y);
    await sleep(1500);
    const after = await evaluate(`(() => {
      const tc = document.body.textContent || '';
      const surfaces = [...document.querySelectorAll('[class*=dialog], [class*=Dialog], [class*=popover], [class*=Popover], [class*=menu], [class*=Menu], [class*=modal], [class*=Modal], [class*=surface], [class*=Surface]')]
        .map(el => ({ cls: String(el.className).slice(0, 50), text: (el.textContent || '').trim().slice(0, 150) }))
        .filter(s => s.text && s.text.length > 3 && !s.text.startsWith('添加文件file反馈'));
      const attachments = [...document.querySelectorAll('[data-composer-input]')].map(el => el.closest('form')?.textContent?.slice(0, 200));
      const toast = [...document.querySelectorAll('[class*=toast], [class*=Toast], [class*=snack], [class*=Snack], [class*=notice]')]
        .map(el => (el.textContent || '').trim().slice(0, 120)).filter(t => t);
      return { textLen: tc.length, surfaces, toast, fileText: tc.includes('选择文件') || tc.includes('上传'), permissionText: tc.includes('仅可查看') || tc.includes('完全权限'), attachments };
    })()`);
    const shot = await call('Page.captureScreenshot');
    const safe = label.replace(/[^\p{L}\p{N}]+/gu, '-');
    await writeFile(join(instance, 'item-' + safe + '.png'), Buffer.from(shot.data, 'base64'));
    results.push({
      label,
      plusMenuOpened: true,
      chooserOpened: events.includes('Page.fileChooserOpened'),
      downloadBegan: events.some(m => m.startsWith('Browser.download')),
      pageEvents: [...new Set(events)],
      after,
      screenshot: join(instance, 'item-' + safe + '.png'),
    });
    // close whatever opened, then make sure the composer is clean again
    for (let k = 0; k < 3; k++) {
      await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await sleep(400);
    }
    const clean = await evaluate(`(() => {
      const tc = document.body.textContent || '';
      const menus = document.querySelectorAll('[role=listbox]').length;
      const dialogs = document.querySelectorAll('[role=dialog], [class*=dialog_], [class*=Dialog_]').length;
      return { menus, dialogs, permissionGone: !tc.includes('仅可查看'), composerValue: (document.querySelector('[data-composer-input]')?.textContent || document.querySelector('[data-composer-input]')?.value || '').slice(0, 40) };
    })()`);
    results[results.length - 1].cleanup = clean;
  }

  const report = { time: new Date().toISOString(), shellVersion, results, dir: instance };
  await writeFile(join(scratch, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 1));
  await call('Page.close').catch(() => {});
  await Promise.race([closed, sleep(5000)]);
  if (child.exitCode === null) child.kill('SIGTERM');
  await Promise.race([closed, sleep(5000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
  console.log('PLUS-MENU-PROBE DONE');
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
