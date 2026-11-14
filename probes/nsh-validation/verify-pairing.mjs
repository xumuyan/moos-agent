import { mkdtemp, readFile, writeFile, rm, chmod, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { request } from 'node:https';
import { checkServerIdentity } from 'node:tls';
import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { startPairingHost } from './pairing-host.mjs';

/** Real HTTPS lifecycle using disposable identities; no returned secrets or response dumps. */
export async function verifyPairing() {
  const dir = await mkdtemp(join(tmpdir(), 'muma-n01-pairing-'));
  let host;
  let time = 0;
  const random = () => randomBytes(32).toString('hex');
  try {
    const openssl = (...args) => execFileSync('/usr/bin/openssl', args, { cwd: dir, stdio: 'pipe' });
    await writeFile(join(dir, 'ca.cnf'), '[req]\ndistinguished_name=dn\nx509_extensions=ca\n[dn]\n[ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n', { mode: 0o600 });
    for (const name of ['ca', 'other']) openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-config', 'ca.cnf', '-keyout', `${name}.key`, '-out', `${name}.pem`, '-days', '2', '-subj', `/CN=N01-pairing-${name}`);
    openssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=localhost');
    await writeFile(join(dir, 'ext.cnf'), 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n', { mode: 0o600 });
    openssl('x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'server.pem', '-days', '1', '-extfile', 'ext.cnf');
    for (const name of ['ca.key', 'other.key', 'server.key']) {
      await chmod(join(dir, name), 0o600);
      assert.equal((await stat(join(dir, name))).mode & 0o777, 0o600);
    }
    assert.equal((await stat(dir)).mode & 0o777, 0o700);
    const tls = { key: await readFile(join(dir, 'server.key')), cert: await readFile(join(dir, 'server.pem')), ca: await readFile(join(dir, 'ca.pem')) };
    host = await startPairingHost({ tls, projects: ['project-a', 'project-b'], now: () => time, invitationMs: 200, credentialMs: 1000 });
    assert.equal(host.address.address, '127.0.0.1');
    let pin = host.invite().leafSHA256;
    const call = (path, { method = 'POST', value = {}, token, ca = tls.ca, headers = {}, raw } = {}) => new Promise((resolve, reject) => {
      const body = raw ?? JSON.stringify(value);
      const req = request(`${host.endpoint}${path}`, { method, ca, agent: false,
        timeout: 3000, checkServerIdentity(hostname, cert) {
          const error = checkServerIdentity(hostname, cert);
          if (error) return error;
          if (createHash('sha256').update(cert.raw).digest('hex') !== pin) return new Error('Test pin rejected');
        }, headers: { ...(method === 'POST' ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }
      }, res => {
        let data = ''; res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, value: JSON.parse(data), headers: res.headers }); } catch (error) { reject(error); }
        });
      });
      req.on('timeout', () => req.destroy(new Error('Test request timed out'))); req.on('error', reject);
      req.end(method === 'POST' ? body : undefined);
    });
    await assert.rejects(call('/v1/pairing/claim', { ca: await readFile(join(dir, 'other.pem')) }));
    const goodPin = pin; pin = '0'.repeat(64);
    await assert.rejects(call('/v1/pairing/claim')); pin = goodPin;
    const invitation = host.invite();
    const input = { invitationId: invitation.invitationId, secret: invitation.secret, clientNonce: random() };
    assert.equal((await call('/v1/pairing/claim', { value: { ...input, secret: random() } })).status, 403);
    const race = await Promise.all([call('/v1/pairing/claim', { value: input }), call('/v1/pairing/claim', { value: input })]);
    assert.deepEqual(race.map(r => r.status).sort(), [200, 403]);
    const claim = race.find(r => r.status === 200).value;
    assert.equal(claim.token, undefined); assert.equal(claim.status, 'pending');
    const proof = { claimId: claim.claimId, receipt: claim.receipt };
    assert.equal((await call('/v1/pairing/redeem', { value: proof })).status, 409);
    for (const route of ['/v1/pairing/confirm', '/v1/pairing/invite', '/v1/pairing/revoke']) {
      assert.equal((await call(route, { value: { claimId: claim.claimId } })).status, 404);
    }
    assert.equal((await call('/v1/pairing/claim?secret=forbidden', { value: input })).status, 404);
    assert.deepEqual(host.pending(), [{ claimId: claim.claimId, transcript: claim.transcript }]);
    assert.throws(() => host.confirm({ claimId: claim.claimId, transcript: random(), allowProjects: ['project-a'] }));
    // Trusted local test API simulates, but is NOT evidence of a human Mac confirmation.
    host.confirm({ claimId: claim.claimId, transcript: claim.transcript, allowProjects: ['project-a'] });
    assert.equal((await call('/v1/pairing/redeem', { value: { ...proof, receipt: random() } })).status, 403);
    const result = await call('/v1/pairing/redeem', { value: proof });
    assert.equal(result.status, 200); assert.equal(result.headers['cache-control'], 'no-store');
    assert.equal((await call('/v1/pairing/redeem', { value: proof })).status, 403);
    const device = result.value;
    assert.equal((await call('/v1/projects/project-a/check', { method: 'GET', token: device.token })).status, 200);
    assert.equal((await call('/v1/projects/project-b/check', { method: 'GET', token: device.token })).status, 404);
    assert.equal((await call('/v1/projects/project-a/check', { method: 'GET' })).status, 401);
    assert.equal(host.revoke(device.deviceId), true);
    assert.equal((await call('/v1/projects/project-a/check', { method: 'GET', token: device.token })).status, 401);
    // A second approved device expires at the exact monotonic deadline.
    const second = host.invite();
    const c2 = (await call('/v1/pairing/claim', { value: { invitationId: second.invitationId, secret: second.secret, clientNonce: random() } })).value;
    host.confirm({ claimId: c2.claimId, transcript: c2.transcript, allowProjects: ['project-b'] });
    const d2 = (await call('/v1/pairing/redeem', { value: { claimId: c2.claimId, receipt: c2.receipt } })).value;
    time = 1000;
    assert.equal((await call('/v1/projects/project-b/check', { method: 'GET', token: d2.token })).status, 401);
    const deniedInvitation = host.invite();
    const deniedClaim = (await call('/v1/pairing/claim', { value: { invitationId: deniedInvitation.invitationId,
      secret: deniedInvitation.secret, clientNonce: random() } })).value;
    host.deny(deniedClaim.claimId);
    assert.equal((await call('/v1/pairing/redeem', { value: { claimId: deniedClaim.claimId, receipt: deniedClaim.receipt } })).status, 403);
    const expired = host.invite(); time += 200;
    assert.equal((await call('/v1/pairing/claim', { value: { invitationId: expired.invitationId, secret: expired.secret, clientNonce: random() } })).status, 403);
    assert.equal((await call('/v1/pairing/claim', { value: input, headers: { origin: 'https://untrusted.invalid' } })).status, 403);
    assert.equal((await call('/v1/pairing/claim', { raw: '{' })).status, 400);
    assert.equal((await call('/v1/pairing/claim', { raw: 'x'.repeat(4097) })).status, 413);
    assert.equal((await call('/v1/pairing/claim', { headers: { 'content-type': 'text/plain' } })).status, 415);
    for (let i = 0; i < 64; i++) await call('/v1/not-found', { method: 'GET' });
    assert.equal((await call('/v1/pairing/claim', { value: input })).status, 429);
    await host.close(); await host.close();
    await assert.rejects(call('/v1/projects/project-a/check', { method: 'GET', token: device.token }));
    return { status: 'passed', target: 'Node HTTPS loopback pairing lifecycle', phoneVerified: false,
      humanConfirmationVerified: false, nativeBootstrapVerified: false, systemTrustChanged: false,
      piTasksConnected: false, credentialsPersisted: false };
  } finally { await host?.close(); await rm(dir, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.umask(0o077);
  console.log(JSON.stringify(await verifyPairing()));
}
