// Actual macOS native parser/candidate acceptance. No phone, UI, long-term trust or LAN.
import { mkdtemp, readFile, writeFile, rm, mkdir, stat, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:https';
import { createHash, X509Certificate } from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { encodeBootstrap } from './bootstrap.mjs';
import { createPairingAuthority } from './pairing.mjs';
process.chdir(fileURLToPath(new URL('../../', import.meta.url)));
process.umask(0o077);
const root = resolve('probes/nsh-validation');
await mkdir('artifacts/nsh-validation/bootstrap', { recursive: true });
const dir = await mkdtemp(resolve('artifacts/nsh-validation/bootstrap/run-'));
const openssl = (...args) => execFileSync('/usr/bin/openssl', args, { cwd: dir, stdio: 'pipe', timeout: 15000 });
let server, child, authority;
try {
  await writeFile(join(dir, 'ca.cnf'), '[req]\ndistinguished_name=dn\nx509_extensions=ca\n[dn]\n[ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n');
  openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-config', 'ca.cnf', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=N01-bootstrap-CA');
  openssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=localhost');
  await writeFile(join(dir, 'ext.cnf'), 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost\n');
  openssl('x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'server.pem', '-days', '1', '-extfile', 'ext.cnf');
  const ca = new X509Certificate(await readFile(join(dir, 'ca.pem'))).raw;
  const leaf = new X509Certificate(await readFile(join(dir, 'server.pem'))).raw;
  let requests = 0;
  server = createServer({ key: await readFile(join(dir, 'server.key')), cert: await readFile(join(dir, 'server.pem')), minVersion: 'TLSv1.2' }, (req, res) => {
    requests++; assert.equal(req.url, '/trust-check'); assert.equal(req.method, 'GET');
    assert.equal(req.headers.authorization, undefined); res.end('N01 pinned TLS OK');
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  authority = createPairingAuthority({ endpoint: `https://localhost:${server.address().port}`, caSHA256: sha(ca), leafSHA256: sha(leaf), projects: ['a'] });
  const invite = authority.invite();
  const material = encodeBootstrap(invite, ca);
  assert.throws(() => encodeBootstrap({ ...invite, endpoint: 'https://192.168.1.2:1234' }, ca));
  assert.throws(() => encodeBootstrap({ ...invite, secret: 'bad' }, ca));
  assert.throws(() => encodeBootstrap({ ...invite, unknown: 1 }, ca));
  assert.throws(() => encodeBootstrap(invite, leaf));
  for (const endpoint of ['https://localhost:65536', 'https://localhost:443', 'https://localhost:01', 'https://localhost:1234/']) {
    assert.throws(() => encodeBootstrap({ ...invite, endpoint }, ca), { message: 'Invalid bootstrap material' });
  }
  assert.throws(() => encodeBootstrap(invite, Buffer.from('not-a-cert')), { message: 'Invalid bootstrap certificate' });
  await writeFile(join(dir, 'bootstrap.bin'), material);
  const sources = ['PinnedTLS.swift', 'Bootstrap.swift', 'BootstrapCheck.swift'].map(p => join(root, p));
  execFileSync('/usr/bin/xcrun', ['swiftc', '-swift-version', '6', ...sources, '-o', join(dir, 'check')], { timeout: 60000, stdio: 'pipe' });
  const sdk = execFileSync('/usr/bin/xcrun', ['--sdk', 'iphoneos', '--show-sdk-path'], { encoding: 'utf8' }).trim();
  execFileSync('/usr/bin/xcrun', ['swiftc', '-swift-version', '6', '-sdk', sdk, '-target', 'arm64-apple-ios15.0', '-typecheck', ...sources.slice(0, 2)], { timeout: 60000, stdio: 'pipe' });
  const finished = new Promise((done, reject) => {
    child = spawn(join(dir, 'check'), [dir], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', error = '';
    child.stdout.on('data', x => output += x); child.stderr.on('data', x => error += x);
    child.once('error', reject);
    child.once('exit', code => code === 0 ? done(output) : reject(new Error(`Native bootstrap failed (${code}): ${error}`)));
  });
  void finished.catch(() => {}); // Observed below; avoid unhandled rejection while polling private IPC.
  const timer = setTimeout(() => child.kill('SIGTERM'), 25000);
  try {
    // No secret body printed; private harness hands native claim to the actual authority in memory.
    let claim;
    for (let i = 0; i < 180; i++) {
      try { claim = JSON.parse(await readFile(join(dir, 'claim.json'), 'utf8')); break; } catch {}
      await new Promise(r => setTimeout(r, 100));
    }
    assert.ok(claim);
    const response = authority.claim(claim);
    assert.equal(response.status, 'pending'); assert.equal(response.token, undefined);
    await writeFile(join(dir, 'response.tmp'), JSON.stringify({ claimId: response.claimId, transcript: response.transcript }));
    await rename(join(dir, 'response.tmp'), join(dir, 'response.json')); // Publish only complete private IPC bytes.
    const output = JSON.parse(await finished);
    assert.equal(output.status, 'passed'); assert.ok(output.checks >= 40);
    assert.equal(requests, 2); // Wrong pin never reaches HTTP. Other candidates remain independent.
    assert.equal((await stat(join(dir, 'bootstrap.bin'))).mode & 0o777, 0o600);
    assert.equal(authority.pending().length, 1); // Never confirmed or promoted.
    console.log(JSON.stringify({ ...output, httpRequests: requests, nativeTarget: 'macOS URLSession', iOS15Typecheck: 'passed',
      nshBridgeVerified: false, claimSentOverHTTPS: false, systemTrustChanged: false, credentialsIssued: false }));
  } finally { clearTimeout(timer); }
} finally {
  child?.kill('SIGTERM'); authority?.close();
  if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
  await rm(dir, { recursive: true, force: true });
}
