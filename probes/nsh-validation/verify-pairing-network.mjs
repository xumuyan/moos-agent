// Real native POSTs to loopback HTTPS; local confirmation is automated, never human evidence.
import { mkdtemp, readFile, writeFile, rm, mkdir, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:https';
import { X509Certificate, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { encodeBootstrap } from './bootstrap.mjs';
import { createPairingAuthority } from './pairing.mjs';
import { startPairingHost } from './pairing-host.mjs';
process.chdir(fileURLToPath(new URL('../../', import.meta.url))); process.umask(0o077);
const base = resolve('artifacts/nsh-validation/pairing-network'); await mkdir(base, { recursive: true });
const dir = await mkdtemp(join(base, 'run-'));
const openssl = (...args) => execFileSync('/usr/bin/openssl', args, { cwd: dir, stdio: 'pipe', timeout: 15000 });
let host, child; const servers = [], authorities = [], counts = {}; let closedBeforeResponse = 0;
try {
  await writeFile(join(dir, 'ca.cnf'), '[req]\ndistinguished_name=dn\nx509_extensions=ca\n[dn]\n[ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n');
  openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-config', 'ca.cnf', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=N01-pairing-network');
  openssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=localhost');
  await writeFile(join(dir, 'ext.cnf'), 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n');
  openssl('x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'server.pem', '-days', '1', '-extfile', 'ext.cnf');
  const tls = { key: await readFile(join(dir, 'server.key')), cert: await readFile(join(dir, 'server.pem')), ca: await readFile(join(dir, 'ca.pem')) };
  const ca = new X509Certificate(tls.ca).raw, leaf = new X509Certificate(tls.cert).raw;
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  host = await startPairingHost({ tls, projects: ['project-a', 'project-b'] });
  await writeFile(join(dir, 'good.bin'), encodeBootstrap(host.invite(), ca));
  // Fault peers keep real TLS/authority transcripts; no invalid-certificate bypass or arbitrary URL API.
  for (const name of ['wrongpin', 'transcript', 'extra', 'version', 'duplicate', 'mime', 'redirect', 'large', 'badjson', 'comparison', 'attempts', 'badredeem', 'cancel', 'taskcancel']) {
    let authority; counts[name] = 0;
    const server = createServer({ ...tls, minVersion: 'TLSv1.2' }, async (req, res) => {
      try {
        counts[name]++; assert.equal(req.method, 'POST'); assert.equal(req.headers.authorization, undefined);
        assert.equal(req.headers['content-type'], 'application/json');
        assert.ok(['/v1/pairing/claim', '/v1/pairing/redeem'].includes(req.url));
        let raw = ''; for await (const chunk of req) { raw += chunk; assert.ok(raw.length <= 4096); }
        if (name === 'cancel') {
          res.once('close', () => { if (!res.writableEnded) closedBeforeResponse++; });
          await writeFile(join(dir, 'active.tmp'), 'active'); await rename(join(dir, 'active.tmp'), join(dir, 'active')); return;
        }
        const input = JSON.parse(raw);
        const reply = req.url.endsWith('/claim') ? authority.claim(input) : name === 'badredeem' ?
          { version: 1, deviceId: 'a'.repeat(64), token: 'b'.repeat(64), expiresInMs: true, projects: ['project-a'] } : null;
        if (reply === null) { res.writeHead(409, { 'content-type': 'application/json' }); res.end('{}'); return; }
        if (name === 'transcript') reply.transcript = '0'.repeat(64);
        if (name === 'extra') reply.unexpected = true;
        if (name === 'version') reply.version = true;
        let bytes = JSON.stringify(reply);
        if (name === 'duplicate') bytes = bytes.replace('"version":1', '"version":1,"version":1');
        if (name === 'badjson') bytes = '{'; if (name === 'large') bytes = 'x'.repeat(4097);
        if (name === 'redirect') { res.writeHead(302, { location: host.endpoint + '/v1/pairing/claim' }); res.end(); return; }
        res.writeHead(200, { 'content-type': name === 'mime' ? 'text/plain' : 'application/json' }); res.end(bytes);
      } catch { res.writeHead(500); res.end(); }
    });
    await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); }); servers.push(server);
    const endpoint = `https://127.0.0.1:${server.address().port}`;
    authority = createPairingAuthority({ endpoint, caSHA256: sha(ca), leafSHA256: sha(leaf), projects: ['project-a'] }); authorities.push(authority);
    const invite = authority.invite(); if (name === 'wrongpin') invite.leafSHA256 = '0'.repeat(64);
    await writeFile(join(dir, `${name}.bin`), encodeBootstrap(invite, ca));
  }
  const root = resolve('probes/nsh-validation');
  const sources = ['PinnedTLS.swift', 'Bootstrap.swift', 'PairingNetworkCheck.swift'].map(p => join(root, p));
  execFileSync('/usr/bin/xcrun', ['swiftc', '-swift-version', '6', ...sources, '-o', join(dir, 'check')], { timeout: 60000, stdio: 'pipe' });
  const sdk = execFileSync('/usr/bin/xcrun', ['--sdk', 'iphoneos', '--show-sdk-path'], { encoding: 'utf8' }).trim();
  execFileSync('/usr/bin/xcrun', ['swiftc', '-swift-version', '6', '-sdk', sdk, '-target', 'arm64-apple-ios15.0', '-typecheck', ...sources.slice(0, 2)], { timeout: 60000, stdio: 'pipe' });
  const finished = new Promise((done, reject) => {
    child = spawn(join(dir, 'check'), [dir], { stdio: ['ignore', 'pipe', 'pipe'] }); let output = '';
    child.stdout.on('data', x => output += x); child.stderr.on('data', () => {}); // Never dump sensitive process state.
    child.once('error', reject); child.once('exit', code => code === 0 ? done(output) : reject(new Error('Native pairing check failed')));
  }); void finished.catch(() => {});
  const timer = setTimeout(() => child.kill('SIGTERM'), 45000);
  try {
    let comparison;
    for (let i = 0; i < 250; i++) {
      try { comparison = await readFile(join(dir, 'comparison.txt'), 'utf8'); break; } catch {}
      await new Promise(r => setTimeout(r, 100));
    }
    assert.ok(comparison); const pending = host.pending(); assert.equal(pending.length, 1);
    assert.equal(comparison, pending[0].transcript);
    host.confirm({ ...pending[0], allowProjects: ['project-a'] }); // Explicit automated trusted-local API only.
    await writeFile(join(dir, 'approved.tmp'), 'approved'); await rename(join(dir, 'approved.tmp'), join(dir, 'approved'));
    const report = JSON.parse(await finished); assert.equal(report.status, 'passed'); assert.ok(report.checks >= 40);
    for (const name of ['wrongpin', 'taskcancel']) assert.equal(counts[name], 0);
    for (const name of ['transcript', 'extra', 'version', 'duplicate', 'mime', 'redirect', 'large', 'badjson', 'comparison', 'cancel']) assert.equal(counts[name], 1);
    assert.equal(counts.attempts, 5); assert.equal(counts.badredeem, 2); assert.equal(closedBeforeResponse, 1);
    assert.equal(host.pending().length, 0);
    console.log(JSON.stringify({ ...report, nativeTarget: 'macOS URLSession', claimSentOverHTTPS: true,
      iOS15Typecheck: 'passed', closedBeforeResponse, taskServerConnected: false }));
  } finally { clearTimeout(timer); }
} finally {
  child?.kill('SIGTERM'); await host?.close(); for (const a of authorities) a.close();
  for (const s of servers) { s.closeAllConnections(); await new Promise(r => s.close(r)); }
  await rm(dir, { recursive: true, force: true });
}
