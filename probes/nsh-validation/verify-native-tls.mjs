/** Native NSH/macOS trust rejection, not iPhone evidence. No system trust changes. */
import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const scratchRoot = join(root, 'artifacts/nsh-validation/native-tls');
await mkdir(scratchRoot, { recursive: true, mode: 0o700 });
const dir = await mkdtemp(join(scratchRoot, 'run-'));
let server;
try {
  execFileSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-days', '1',
    '-subj', '/CN=localhost'], { stdio: 'ignore' });
  let requests = 0;
  server = createServer({ key: await readFile(join(dir, 'key.pem')), cert: await readFile(join(dir, 'cert.pem')) }, (_, res) => {
    requests++; res.end('must not reach HTTP');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  const app = join(dir, 'app'); await mkdir(app);
  await writeFile(join(app, 'nsh.json'), JSON.stringify({ name: 'N01 TLS rejection check', id: 'dev.muma.probe.nsh.tlscheck',
    capabilities: { network: { http: [{ host: 'localhost', port, methods: ['GET'], schemes: ['https'], paths: ['/trust-check'], pathPrefixes: ['/v1/tasks'] }] } } }));
  await writeFile(join(app, 'task-client.ts'), await readFile(join(root, 'probes/nsh-validation/task-client.ts')));
  await writeFile(join(app, 'App.tsx'), `import { mount, signal, Text } from 'nsh';
import { createTaskClient } from './task-client';
const clientStatus = signal('client_waiting');
createTaskClient('https://localhost:${port}', 'a'.repeat(64))
.poll('12345678-1234-1234-1234-123456789012')
.then(() => clientStatus.set('unexpected_client_http'))
.catch(error => clientStatus.set(error.code === 'network_or_tls' ? 'client_tls_rejected' : 'client_other_failure'));
const status = signal('waiting');
fetch('https://localhost:${port}/trust-check', { signal: AbortSignal.timeout(6000), redirect: 'error' })
.then(() => status.set('unexpected_http'))
.catch(error => {
 const message = String(error);
 status.set(error.code === 'ERR_ACCESS_DENIED' ? 'capability_denied' : /certificate|SSL|trust|-1202/i.test(message) ? 'tls_rejected' : 'other_failure');
 console.log('N01 native TLS diagnosis: ' + message);
});
mount(() => <Text>{status() + ' ' + clientStatus()}</Text>);`);
  await writeFile(join(app, 'Trust.test.tsx'), `import { open, test } from 'nsh/test';
test('native NSURLSession refuses untrusted local certificate after capability grant', async () => {
 const app = await open('./App.tsx', { network: 'live' });
 await app.waitFor('text:tls_rejected client_tls_rejected', { timeout: 10000 });
});`);
  const nsh = resolve(root, 'artifacts/nsh-validation/toolchain/nsh/bin/nsh');
  assert.equal(execFileSync(nsh, ['--version'], { encoding: 'utf8' }).trim(), 'nsh 0.5.0 (f4d68f7)');
  const result = await new Promise((resolve, reject) => {
    const child = spawn(nsh, ['test', app, '--target', 'macos'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', c => { output += c; }); child.stderr.on('data', c => { output += c; });
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Native TLS check timed out')); }, 45000);
    child.once('error', reject); child.once('close', code => { clearTimeout(timer); resolve({ code, output }); });
  });
  console.log(result.output);
  assert.equal(result.code, 0); assert.equal(requests, 0);
  console.log(JSON.stringify({ status: 'passed', target: 'macOS AppKit NSH 0.5.0',
    untrustedCertificateRejected: true, httpRequestsReceived: requests,
    phoneVerified: false, systemTrustChanged: false }));
} finally {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await rm(dir, { recursive: true, force: true });
}
