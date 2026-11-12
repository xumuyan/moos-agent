// Diagnostic (kept as evidence of the DOM race investigation): dump how the
// permission composer control appears in DOM/text of a given isolated build.
// Found during E134: innerText/body probes race with locale + bottom-bar mount;
// waiting ~3s after the composer reveals button.SJRB_q_trigger
// (aria-label prefix 访问模式) whose popover carries the three preset labels.
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createInterface } from 'node:readline';
import { startFixture } from 'file:///Users/xuguopeng/Documents/%E5%BE%90%E9%83%AD%E9%B9%8F%E9%A1%B9%E7%9B%AE/%E5%BE%90-moos-agent/services/agent/fixture.mjs';
import { checkedProvider } from 'file:///Users/xuguopeng/Documents/%E5%BE%90%E9%83%AD%E9%B9%8F%E9%A1%B9%E7%9B%AE/%E5%BE%90-moos-agent/packages/pi-adapter/index.mjs';
import { piModels } from 'file:///Users/xuguopeng/Documents/%E5%BE%90%E9%83%AD%E9%B9%8F%E9%A1%B9%E7%9B%AE/%E5%BE%90-moos-agent/apps/electron/plugin/pi-models.js';
import { seedHome } from 'file:///Users/xuguopeng/Documents/%E5%BE%90%E9%83%AD%E9%B9%8F%E9%A1%B9%E7%9B%AE/%E5%BE%90-moos-agent/apps/electron/profile-home.mjs';

const repo = '/Users/xuguopeng/Documents/徐郭鹏项目/徐-moos-agent';
const [buildPath] = process.argv.slice(2);
const scratch = await mkdtemp(join(repo, 'artifacts/remove-permission-menu', 'probe-'));
const app = join(scratch, 'Moos.app');
execFileSync('/usr/bin/ditto', [resolve(buildPath), app]);
const resources = join(app, 'Contents/Resources');
const entry = join(resources, 'app/main.mjs');
await writeFile(entry, (await readFile(entry, 'utf8')).replace("app.setName('Moos');", "BrowserWindow.prototype.show = function () {};\napp.setName('Moos');"));
execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'ignore' });
const data = join(scratch, 'data');
await seedHome(resources, join(data, 'dsh'));
const relay = await startFixture({ desktopPolicy: true });
await piModels(data, checkedProvider).save({ id: 'probe', name: '诊断', model: 'moos-fixture',
  baseUrl: relay.baseUrl, service: 'openai', api: 'openai-completions', apiKey: relay.apiKey });

const macosDir = join(app, 'Contents/MacOS');
const [executable] = (await readdir(macosDir)).filter(n => !n.startsWith('_'));
const child = spawn(join(macosDir, executable), ['--remote-debugging-port=0'],
  { env: { ...process.env, MOOS_ELECTRON_DATA: data }, stdio: ['ignore', 'ignore', 'pipe'] });
const closed = new Promise(r => child.once('exit', r));
let port;
const lines = createInterface({ input: child.stderr });
lines.on('line', line => { const m = line.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/); if (m) port = m[1]; });
for (let i = 0; i < 240 && !port; i++) await sleep(250);
let target;
for (let i = 0; i < 240; i++) {
  const list = await fetch('http://127.0.0.1:' + port + '/json/list').then(r => r.json()).catch(() => []);
  target = list.find(row => row.url.startsWith('http://127.0.0.1:'));
  if (target) break;
  await sleep(250);
}
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { socket.addEventListener('open', r, { once: true }); socket.addEventListener('error', j, { once: true }); });
let seq = 0;
const pending = new Map();
socket.addEventListener('message', e => { const res = JSON.parse(e.data); pending.get(res.id)?.(res); });
const call = (method, params = {}) => new Promise((r, j) => {
  const id = ++seq;
  const t = setTimeout(() => { pending.delete(id); j(new Error('CDP timeout')); }, 15000);
  pending.set(id, res => { clearTimeout(t); pending.delete(id); res.error ? j(new Error(res.error.message)) : r(res.result); });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails).slice(0, 400));
  return result.result.value;
};
let composer = false;
for (let i = 0; i < 240 && !composer; i++) {
  composer = await evaluate(`!!document.querySelector('[data-composer-input]')`).catch(() => false);
  await sleep(250);
}
console.log('composer ready:', composer);
await sleep(3000); // locale + bottom-bar controls may render after the input element
const info = await evaluate(`(() => {
  const tc = document.body.textContent || '';
  const hits = ['仅可查看','工作区内修改','完全权限'].map(l => ({ label: l, inTextContent: tc.includes(l), count: tc.split(l).length - 1 }));
  const deepest = [...document.querySelectorAll('*')].filter(el =>
    el.children.length === 0 && /工作区内修改|仅可查看|完全权限/.test(el.textContent || ''))
    .slice(0, 6).map(el => ({ tag: el.tagName, cls: String(el.className).slice(0, 80), text: (el.textContent || '').slice(0, 30) }));
  const triggers = [...document.querySelectorAll('[aria-haspopup], [role=button], button')].filter(el =>
    /权限|修改|查看/.test(el.textContent || '') || /permission/i.test(el.getAttribute('aria-label') || '')).slice(0, 6)
    .map(el => ({ tag: el.tagName, cls: String(el.className).slice(0, 80), text: (el.textContent || '').slice(0, 30), aria: el.getAttribute('aria-label') }));
  const iframes = document.querySelectorAll('iframe').length;
  const roots = [...document.querySelectorAll('body *')].filter(el => el.shadowRoot).length;
  return { hits, deepest, triggers, iframes, shadowHosts: roots, innerTextLen: document.body.innerText.length, textContentLen: tc.length, head: tc.slice(0, 300), tail: tc.slice(-350) };
})()`);
console.log(JSON.stringify(info, null, 2));
const shot = await call('Page.captureScreenshot');
await writeFile(join(scratch, 'probe.png'), Buffer.from(shot.data, 'base64'));
await call('Page.close').catch(() => {});
await Promise.race([closed, sleep(4000)]);
if (child.exitCode === null) child.kill('SIGKILL');
lines.close();
socket.close();
await relay.close().catch(() => {});
await rm(join(scratch, 'Moos.app'), { recursive: true, force: true }).catch(() => {});
await rm(join(scratch, 'data'), { recursive: true, force: true }).catch(() => {});
console.log('probe dir kept:', scratch);
