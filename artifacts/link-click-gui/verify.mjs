// End-to-end verification: clicking a chat-style link in the packaged MuMa
// window must open the system browser, which then hits our probe server.
// Launches the candidate build with an isolated data dir + CDP, injects an
// anchor click on the workspace page, and asserts the probe server got the hit.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const buildDir = resolve(process.argv[2]);
const bin = join(buildDir, '沐码.app/Contents/MacOS/MuMa');
if (!buildDir || !bin) throw new Error('usage: node verify.mjs <build-dir>');

const PORT = Number(process.env.PROBE_PORT || 51731);
const hits = [];
const probe = createServer((req, res) => {
  hits.push(req.url);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<html><body><p>link verification received</p></body></html>');
});
await new Promise(r => probe.listen(PORT, '127.0.0.1', r));
console.log(`probe server on http://127.0.0.1:${PORT}`);

const smoke = mkdtempSync(join(tmpdir(), 'moos-link-e2e.'));
const env = {
  HOME: process.env.HOME, TMPDIR: '/private/tmp', PATH: process.env.PATH,
  MOOS_ELECTRON_DATA: join(smoke, 'data'),
};
const child = spawn(bin, ['--remote-debugging-port=9223'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
const log = [];
child.stdout.on('data', d => log.push(d));
child.stderr.on('data', d => log.push(d));

const wait = ms => new Promise(r => setTimeout(r, ms));
let wsUrl;
for (let i = 0; i < 40 && !wsUrl; i++) {
  await wait(500);
  try {
    const list = await (await fetch('http://127.0.0.1:9223/json')).json();
    const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    if (page) wsUrl = page.webSocketDebuggerUrl;
  } catch { /* not ready yet */ }
}
if (!wsUrl) {
  console.error('FAIL: CDP page target not found; app log:', log.join('').slice(-2000));
  child.kill('SIGKILL'); probe.close(); rmSync(smoke, { recursive: true, force: true });
  process.exit(1);
}
console.log('page target:', wsUrl);

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
await call('Runtime.enable');
// wait for the workspace page to settle, then simulate the chat-link click
await wait(4000);
await call('Runtime.evaluate', {
  expression: `(() => {
    const a = document.createElement('a');
    a.href = 'http://127.0.0.1:${PORT}/link-ok?from=muma';
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return 'clicked';
  })()`,
  returnByValue: true,
});
console.log('anchor click injected (target=_blank -> window-open path)');

let ok = false;
for (let i = 0; i < 30; i++) {
  await wait(1000);
  if (hits.some(u => u.includes('/link-ok'))) { ok = true; break; }
}
console.log('probe hits after window-open path:', hits);
console.log(ok ? 'PASS: system browser opened the link and reached the probe server'
               : 'FAIL: no probe hit within 30s');

// second path: plain anchor without target -> will-navigate handler
const hitsBefore = hits.length;
await call('Runtime.evaluate', {
  expression: `(() => {
    const a = document.createElement('a');
    a.href = 'http://127.0.0.1:${PORT}/link-ok?from=plain';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return 'clicked-plain';
  })()`,
  returnByValue: true,
});
console.log('plain anchor click injected (no target -> will-navigate path)');
let okPlain = false;
for (let i = 0; i < 30; i++) {
  await wait(1000);
  if (hits.length > hitsBefore && hits.some(u => u.includes('from=plain'))) { okPlain = true; break; }
}
console.log('probe hits after plain path:', hits);
console.log(okPlain ? 'PASS: will-navigate path also opens the system browser'
                    : 'FAIL: plain-link path did not reach the probe server');

child.kill('SIGTERM');
await wait(3000);
if (!child.killed) child.kill('SIGKILL');
probe.close();
rmSync(smoke, { recursive: true, force: true });
process.exit(ok && okPlain ? 0 : 1);
