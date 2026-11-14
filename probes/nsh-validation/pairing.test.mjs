import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createPairingAuthority, PairingError } from './pairing.mjs';
import { verifyPairing } from './verify-pairing.mjs';
const random = () => randomBytes(32).toString('hex');
function setup(options = {}) {
  let time = 0;
  const authority = createPairingAuthority({ endpoint: 'https://127.0.0.1:4443', caSHA256: random(), leafSHA256: random(),
    projects: ['a', 'b'], now: () => time, invitationMs: 100, credentialMs: 500, ...options });
  const claim = () => {
    const invite = authority.invite();
    return authority.claim({ invitationId: invite.invitationId, secret: invite.secret, clientNonce: random() });
  };
  const approve = c => authority.confirm({ claimId: c.claimId, transcript: c.transcript, allowProjects: ['a'] });
  const redeem = c => authority.redeem({ claimId: c.claimId, receipt: c.receipt });
  return { authority, claim, approve, redeem, setTime: value => time = value };
}
function rejected(fn, status) {
  assert.throws(fn, error => error instanceof PairingError && error.status === status
    && error.message === 'Pairing request rejected');
}

test('pairing requires exact one-use secret, local transcript confirmation and one-time delivery', () => {
  const projects = ['a', 'b'];
  const { authority: a, claim, approve, redeem } = setup({ projects });
  projects.push('other'); // Original configuration cannot expand authority grants.
  const invitation = a.invite();
  const request = { invitationId: invitation.invitationId, secret: invitation.secret, clientNonce: random() };
  rejected(() => a.claim({ ...request, secret: random() }), 403);
  rejected(() => a.claim({ ...request, extra: true }), 400);
  rejected(() => a.claim({ ...request, clientNonce: 3 }), 403);
  const c = a.claim(request);
  assert.equal(c.token, undefined);
  rejected(() => a.claim(request), 403);
  rejected(() => redeem(c), 409);
  rejected(() => a.confirm({ claimId: c.claimId, transcript: random(), allowProjects: ['a'] }), 403);
  rejected(() => a.confirm({ claimId: c.claimId, transcript: c.transcript, allowProjects: ['other'] }), 400);
  rejected(() => a.confirm({ claimId: c.claimId, transcript: c.transcript, allowProjects: [] }), 400);
  rejected(() => a.confirm({ claimId: c.claimId, transcript: c.transcript, allowProjects: ['a', 'a'] }), 400);
  approve(c); rejected(() => approve(c), 403);
  rejected(() => a.redeem({ claimId: c.claimId, receipt: random() }), 403);
  const device = redeem(c);
  rejected(() => redeem(c), 403);
  device.projects.push('b'); // Caller cannot mutate server-side grants.
  assert.equal(a.authenticate(device.token, 'a').deviceId, device.deviceId);
  rejected(() => a.authenticate(device.token, 'b'), 404);
  rejected(() => a.authenticate(random(), 'a'), 401);
  rejected(() => a.authenticate({}, 'a'), 401);
  const another = claim(); approve(another); const d2 = redeem(another);
  assert.equal(a.revoke(device.deviceId), true); assert.equal(a.revoke(device.deviceId), false);
  rejected(() => a.authenticate(device.token, 'a'), 401);
  assert.equal(a.authenticate(d2.token, 'a').deviceId, d2.deviceId);
});

test('invitation, pending approval and approved receipt expire at monotonic boundaries', () => {
  const { authority: a, claim, approve, redeem, setTime } = setup();
  const invite = a.invite(); const pending = claim(); const approved = claim(); approve(approved);
  setTime(100);
  rejected(() => a.claim({ invitationId: invite.invitationId, secret: invite.secret, clientNonce: random() }), 403);
  rejected(() => approve(pending), 403); rejected(() => redeem(approved), 403);
  assert.deepEqual(a.pending(), []);
  const c = claim(); approve(c); const d = redeem(c);
  setTime(599); assert.equal(a.authenticate(d.token, 'a').deviceId, d.deviceId);
  setTime(600); rejected(() => a.authenticate(d.token, 'a'), 401);
  const denied = claim(); a.deny(denied.claimId); rejected(() => approve(denied), 403);
});

test('pairing has bounded state, deny frees capacity, restart and bad clock fail closed', () => {
  const { authority: a, claim, approve, redeem, setTime } = setup();
  for (let i = 0; i < 8; i++) claim();
  rejected(() => a.invite(), 429);
  a.deny(a.pending()[0].claimId); a.invite();
  setTime(100);
  const devices = [];
  for (let i = 0; i < 8; i++) { const c = claim(); approve(c); devices.push(redeem(c)); }
  rejected(() => a.invite(), 429);
  a.revoke(devices[0].deviceId); a.invite();
  const fresh = setup().authority;
  rejected(() => fresh.authenticate(devices[1].token, 'a'), 401);
  a.close(); a.close(); rejected(() => a.authenticate(devices[1].token, 'a'), 503);
  const rollback = setup(); rollback.setTime(3); rollback.authority.invite();
  rollback.setTime(2); rejected(() => rollback.authority.pending(), 503);
  rollback.setTime(4); rejected(() => rollback.authority.invite(), 503);
  const broken = setup({ now: () => NaN }).authority; rejected(() => broken.invite(), 503);
});

test('pairing configuration cannot enable arbitrary LAN origins or unbounded lifetime', () => {
  for (const endpoint of ['http://127.0.0.1:4', 'https://192.168.1.4:4', 'https://example.invalid',
    'https://u:p@localhost:4', 'https://localhost:4/path', 'https://localhost:4?secret=bad']) {
    assert.throws(() => setup({ endpoint }));
  }
  for (const options of [{ invitationMs: 120001 }, { credentialMs: 3600001 }, { projects: ['a', 'a'] },
    { projects: ['../a'] }, { leafSHA256: 'untrusted' }, { projects: [] }]) assert.throws(() => setup(options));
});

test('real loopback HTTPS pairs only after local approval, enforces grants, expiry and revocation', { timeout: 30000 }, async () => {
  const result = await verifyPairing();
  assert.equal(result.status, 'passed');
  assert.equal(result.phoneVerified, false); assert.equal(result.humanConfirmationVerified, false);
  assert.equal(result.nativeBootstrapVerified, false);
});
