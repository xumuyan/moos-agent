import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:https';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('../../', import.meta.url)));
process.umask(0o077);
const root = resolve('probes/nsh-validation');
await mkdir('artifacts/nsh-validation/pinned-tls', { recursive: true });
const dir = await mkdtemp(resolve('artifacts/nsh-validation/pinned-tls/run-'));
const openssl = (...args) => execFileSync('/usr/bin/openssl', args, { cwd: dir, stdio: 'pipe' });
const servers = [];
try {
  for (const name of ['ca', 'other']) {
    openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${name}.key`, '-out', `${name}.pem`, '-days', '2', '-subj', `/CN=N01-${name}`);
    openssl('x509', '-in', `${name}.pem`, '-outform', 'DER', '-out', `${name}.der`);
  }
  openssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=localhost');
  await writeFile(join(dir, 'ext.cnf'), 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost\n');
  openssl('x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'server.pem', '-days', '1', '-extfile', 'ext.cnf');
  openssl('x509', '-in', 'server.pem', '-outform', 'DER', '-out', 'server.der');
  openssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'rotated.key', '-out', 'rotated.csr', '-subj', '/CN=localhost');
  openssl('x509', '-req', '-in', 'rotated.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAserial', 'ca.srl', '-out', 'rotated.pem', '-days', '1', '-extfile', 'ext.cnf');
  openssl('x509', '-in', 'rotated.pem', '-outform', 'DER', '-out', 'rotated.der');
  const tls = { key: await readFile(join(dir, 'server.key')), cert: await readFile(join(dir, 'server.pem')), minVersion: 'TLSv1.2' };
  const counts = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const server = createServer(tls, (req, res) => {
      counts[i]++;
      assert.equal(req.url, '/trust-check');
      assert.equal(req.headers.authorization, undefined);
      if (i === 1) { res.writeHead(302, { location: 'https://localhost:1/should-never-follow' }); res.end(); }
      else res.end(i === 2 ? 'x'.repeat(4097) : 'N01 pinned TLS OK');
    });
    await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
    servers.push(server);
  }
  const sources = [join(root, 'PinnedTLS.swift'), join(root, 'PinnedTLSCheck.swift')];
  execFileSync('/usr/bin/xcrun', ['swiftc', '-swift-version', '6', ...sources, '-o', join(dir, 'check')], { stdio: 'pipe' });
  const sdk = execFileSync('/usr/bin/xcrun', ['--sdk', 'iphoneos', '--show-sdk-path'], { encoding: 'utf8' }).trim();
  execFileSync('/usr/bin/xcrun', ['swiftc', '-swift-version', '6', '-sdk', sdk, '-target', 'arm64-apple-ios15.0', '-typecheck', join(root, 'PinnedTLS.swift')], { stdio: 'pipe' });
  const args = servers.map(s => `https://localhost:${s.address().port}/trust-check`);
  await new Promise((done, reject) => {
    const child = spawn(join(dir, 'check'), [dir, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', x => out += x); child.stderr.on('data', x => err += x);
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('pin check timed out')); }, 30000);
    child.once('error', reject);
    child.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(new Error(`pin check failed (${code}): ${err}`)); else { console.log(out.trim()); done(); } });
  });
  assert.deepEqual(counts, [1, 1, 1]); // Wrong pin never reaches the HTTP handler.
  console.log(JSON.stringify({ target: 'macOS native URLSession', iOS15Typecheck: 'passed', httpRequests: counts, nshBridgeVerified: false }));
} finally {
  for (const s of servers) { s.closeAllConnections(); await new Promise(r => s.close(r)); }
  await rm(dir, { recursive: true, force: true });
}
