// End-to-end verification (E115): "copy image" in the packaged MuMa window
// must land the PNG in the system clipboard. Root cause fixed in main.mjs:
// the persist:moos-workbench partition denied every permission including
// clipboard-sanitized-write, so navigator.clipboard.write always threw.
// Launches the candidate build (isolated data dir + CDP), exercises a real
// CDP click + the plugin-style promise ClipboardItem write, and asserts the
// system clipboard really contains PNG data afterwards.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const buildDir = resolve(process.argv[2]);
const bin = join(buildDir, '沐码.app/Contents/MacOS/MuMa');
if (!buildDir || !bin) throw new Error('usage: node copy-image-repro.mjs <build-dir>');

const smoke = mkdtempSync(join(tmpdir(), 'moos-copy-e2e.'));
// A small real PNG in the workspace uploads dir, like a pasted screenshot.
const uploads = join(smoke, 'workspace', 'project', '.moos-uploads');
mkdirSync(uploads, { recursive: true });
// 1x1 red PNG
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
writeFileSync(join(uploads, 'repro.png'), png);
writeFileSync(join(smoke, 'workspace', 'project', 'AGENTS.md'), '# repro\n');

const env = {
  HOME: process.env.HOME, TMPDIR: '/private/tmp', PATH: process.env.PATH,
  MOOS_ELECTRON_DATA: join(smoke, 'data'),
};
const child = spawn(bin, ['--remote-debugging-port=9224'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
const log = [];
child.stdout.on('data', d => log.push(d));
child.stderr.on('data', d => log.push(d));

const wait = ms => new Promise(r => setTimeout(r, ms));
let wsUrl;
for (let i = 0; i < 40 && !wsUrl; i++) {
  await wait(500);
  try {
    const list = await (await fetch('http://127.0.0.1:9224/json')).json();
    const page = list.find(t => t.type === 'page' && /dsh|index|web/.test(t.url) && t.webSocketDebuggerUrl) || list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    if (page) wsUrl = page.webSocketDebuggerUrl;
  } catch { /* not ready */ }
}
if (!wsUrl) {
  console.error('FAIL: CDP page target not found; log:', log.join('').slice(-1500));
  child.kill('SIGKILL'); rmSync(smoke, { recursive: true, force: true });
  process.exit(1);
}
console.log('page target ok');

const ws = new WebSocket(wsUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const call = (method, params = {}) => new Promise((r, j) => {
  const mid = ++id;
  const onmsg = ev => {
    const m = JSON.parse(ev.data);
    if (m.id === mid) { ws.removeEventListener('message', onmsg); m.error ? j(new Error(m.error.message)) : r(m.result); }
  };
  ws.addEventListener('message', onmsg);
  ws.send(JSON.stringify({ id: mid, method, params }));
});
const evalJs = async expression => {
  const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) return { threw: true, text: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
  return { threw: false, value: r.result.value };
};
// focus + settle
await wait(3000);
await evalJs('window.focus()');
await evalJs('document.hasFocus()').then(r => console.log('hasFocus:', JSON.stringify(r.value)));

// Real trusted click via CDP input domain, then write immediately (has user activation).
await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 200, y: 200, button: 'left', clickCount: 1 });
await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 200, y: 200, button: 'left', clickCount: 1 });
await wait(100);
const rAct = await evalJs(`(async () => {
  const b64 = '${png.toString('base64')}';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/png' });
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return 'write after real click: ok';
  } catch (e) { return 'write after real click: ' + e.name + ': ' + e.message; }
})()`);
console.log(rAct.threw ? rAct.text : rAct.value);

const expr = `(async () => {
  const out = {};
  const b64 = '${png.toString('base64')}';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/png' });
  out.hasClipboard = typeof navigator.clipboard?.write === 'function';
  out.hasClipboardItem = typeof ClipboardItem === 'function';
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    out.directWrite = 'ok';
  } catch (e) { out.directWrite = e.name + ': ' + e.message; }
  return JSON.stringify(out);
})()`;
const r = await evalJs(expr);
console.log('direct write:', r.threw ? r.text : r.value);

// Simulate the plugin path: async gap (RPC) then promise-valued ClipboardItem.
const expr2 = `(async () => {
  const b64 = '${png.toString('base64')}';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/png' });
  const delay = ms => new Promise(r => setTimeout(r, ms));
  try {
    await delay(120); // like the workspaceFiles.readBytes RPC round trip
    const pngPromise = Promise.resolve(blob);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngPromise })]);
    return 'plugin-style ok';
  } catch (e) { return e.name + ': ' + e.message; }
})()`;
const r2 = await evalJs(expr2);
console.log('plugin-style write:', r2.threw ? r2.text : r2.value);

child.kill('SIGKILL');
await wait(500);
rmSync(smoke, { recursive: true, force: true });

// System clipboard must now carry real PNG data (1x1 red PNG).
const { execFileSync } = await import('node:child_process');
const info = execFileSync('osascript', ['-e', 'clipboard info'], { encoding: 'utf8' });
const ok = rAct.threw ? false : String(rAct.value).includes('ok')
  && String(r2.threw ? r2.text : r2.value).includes('ok')
  && info.includes('«class PNGf»');
console.log('clipboard PNGf:', info.includes('«class PNGf»') ? 'present' : 'MISSING');
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
