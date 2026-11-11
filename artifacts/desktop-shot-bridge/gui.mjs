// Explicit isolated Electron acceptance; never targets the installed Moos or user data.
// Verifies P06.5a: a fixture task whose PI model calls desktop_screenshot (via the
// synthetic MOOS_DESKTOP_HELPER) produces a chat-visible restricted thumbnail
// (img[data-moos-desktop-shot]) fetched over the moos:pi-shot IPC bridge, while no
// screenshot path or raw tool output appears in the page. Screenshots and a report
// are saved next to the report.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, realpath, writeFile, appendFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createInterface } from 'node:readline';
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
if (!clientSource.includes('data-moos-desktop-shot')) throw new Error('Isolated build lacks the desktop shot bridge change');
const entry = join(resources, 'app/main.mjs');
await writeFile(entry, (await readFile(entry, 'utf8')).replace("app.setName('沐码');", "BrowserWindow.prototype.show = function () {};\napp.setName('沐码');"));
// Synthetic desktop helper (isolated acceptance only): writes a tiny valid PNG for every
// screenshot call and answers the helper v2 protocol. No screen recording is performed.
const helper = join(scratch, 'moos-desktop-helper-fixture.mjs');
await writeFile(helper, `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
const argv = process.argv.slice(2);
const out = argv[argv.indexOf('--out') + 1];
function crc32(buf) {
  let c; let crc = 0xffffffff;
  for (const byte of buf) {
    c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function png(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) {
      row[1 + x * 3] = 30 + Math.floor(160 * x / width);
      row[2 + x * 3] = 90 + Math.floor(100 * y / height);
      row[3 + x * 3] = 200;
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0)),
  ]);
}
if (out) writeFileSync(out, png(96, 48));
process.stdout.write(JSON.stringify({
  status: 'ok', scope: argv.includes('--window-id') ? 'window' : 'display', imageWidth: 96, imageHeight: 48,
}));
`);
await chmod(helper, 0o755);
execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'ignore' });
const data = join(scratch, 'data');
const home = join(data, 'dsh');
await seedHome(resources, home);
const relay = await startFixture({ desktopPolicy: true });
await piModels(data, checkedProvider).save({ id: 'shot-fixture', name: '截图桥隔离验收', model: 'moos-fixture',
  baseUrl: relay.baseUrl, service: 'openai', api: 'openai-completions', apiKey: relay.apiKey });
let child;
const sockets = [];
async function until(fn, label) {
  for (let i = 0; i < 240; i++) {
    const result = await fn().catch(() => null);
    if (result) return result;
    if (child?.exitCode !== null) break;
    await sleep(250);
  }
  throw new Error('Did not observe ' + label);
}
async function launch() {
  // Host passthrough (danger mode) leaks ELECTRON_RUN_AS_NODE and MOOS_ELECTRON_*/DSH_* into this
  // process; the isolated instance must start as a real GUI app, so strip them like the installer
  // does. MOOS_DESKTOP_HELPER is deliberately kept: it points the PI desktop tools at the
  // synthetic helper above instead of the packaged binary.
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name === 'ELECTRON_RUN_AS_NODE' || name.startsWith('MOOS_ELECTRON_') || name.startsWith('DSH_')) delete env[name];
  }
  env.TMPDIR = '/private/tmp/';
  env.MOOS_ELECTRON_DATA = data;
  env.MOOS_DESKTOP_HELPER = helper;
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
  return { call, evaluate, capture, submit, stop: async () => {
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

try {
  const gui = await launch();
  await gui.submit('MOOS_FIXTURE_SHOT');
  // The thumbnail appears once moosTurn delivers shots and moos:pi-shot returns the data URL.
  const shotInfo = await until(() => gui.evaluate(`(() => {
    const img = document.querySelector('img[data-moos-desktop-shot]');
    if (!img || !img.complete || !img.naturalWidth) return null;
    return { id: img.getAttribute('data-moos-desktop-shot'), naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight, dataUrlLength: (img.src || '').length,
      title: img.getAttribute('title'), alt: img.getAttribute('alt') };
  })()`), 'desktop shot thumbnail rendered');
  const summary = await gui.evaluate(`document.querySelector('[data-moos-pi-process] summary')?.textContent ?? null`);
  assert.match(summary ?? '', /执行过程 · 1 项操作 · 已完成/);
  const done = await gui.evaluate(`document.body.innerText.includes('完成 SHOT')`);
  assert.equal(done, true, 'fixture turn completed');
  const leaks = await gui.evaluate(`(() => ({
    inner: document.body.innerText.includes('/screenshots/'),
    html: document.documentElement.outerHTML.includes('sessions/screenshots'),
  }))()`);
  assert.equal(leaks.inner, false, 'no screenshot path in page text');
  assert.equal(leaks.html, false, 'no screenshot path anywhere in the DOM');
  const placeholder = await gui.evaluate(`document.querySelectorAll('[data-moos-desktop-shots]').length`);
  await gui.capture('shot-bridge');
  const report = {
    shellVersion,
    scenario: 'MOOS_FIXTURE_SHOT via synthetic MOOS_DESKTOP_HELPER (helper v2 protocol, no screen recording)',
    checks: {
      thumbnailRendered: true, shotId: shotInfo.id, naturalWidth: shotInfo.naturalWidth,
      naturalHeight: shotInfo.naturalHeight, dataUrlLength: shotInfo.dataUrlLength,
      title: shotInfo.title, alt: shotInfo.alt, summaryText: summary,
      shotRowsInDom: placeholder, noPathInText: leaks.inner === false, noPathInDom: leaks.html === false,
      turnCompleted: done,
    },
  };
  await writeFile(join(scratch, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const exit = await gui.stop();
  await relay.close();
  await writeFile(join(scratch, 'exit.json'), JSON.stringify({ ...exit }) + '\n');
  console.log(JSON.stringify(report, null, 2));
  console.log('exit:', JSON.stringify(exit));
} catch (error) {
  if (child && child.exitCode === null) { child.kill('SIGKILL'); }
  for (const socket of sockets) socket.close().catch?.(() => {});
  throw error;
}
