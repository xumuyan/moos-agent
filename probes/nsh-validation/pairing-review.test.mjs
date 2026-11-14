import test from 'node:test';
import assert from 'node:assert/strict';
import { createPairingAuthority } from './pairing.mjs';
import { createPairingReviewer } from './pairing-review.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const endpoint = 'https://127.0.0.1:12345';
function fixture(options = {}) {
  let clock = 0;
  const authority = createPairingAuthority({ endpoint, caSHA256: 'a'.repeat(64), leafSHA256: 'b'.repeat(64), projects: ['project-a'], now: () => clock });
  const invite = authority.invite();
  const claim = authority.claim({ invitationId: invite.invitationId, secret: invite.secret, clientNonce: 'c'.repeat(64) });
  const reviewer = createPairingReviewer({ authority, endpoint, now: () => clock, ...options });
  const args = present => ({ claimId: claim.claimId, projects: ['project-a'], present });
  const reply = (s, decision = 'approve') => ({ version: 1, requestId: s.requestId, claimId: s.claimId, transcript: s.transcript, decision });
  return { authority, claim, reviewer, args, reply, tick: value => clock = value };
}
test('trusted local review snapshots project grants and requires exact current request binding', async () => {
  const f = fixture(); let snapshot, respond;
  const projects = ['project-a'];
  const pending = f.reviewer.review({ ...f.args(s => { snapshot = s; return new Promise(r => respond = r); }), projects });
  await new Promise(r => setImmediate(r)); projects.push('other');
  assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.projects));
  assert.deepEqual(snapshot.projects, ['project-a']);
  assert.equal(snapshot.secret, undefined); assert.equal(snapshot.receipt, undefined);
  assert.throws(() => f.authority.redeem({ claimId: f.claim.claimId, receipt: f.claim.receipt }), { status: 409 });
  await assert.rejects(f.reviewer.review(f.args(() => {})));
  respond(f.reply(snapshot)); assert.equal((await pending).status, 'approved');
  assert.deepEqual(f.authority.redeem({ claimId: f.claim.claimId, receipt: f.claim.receipt }).projects, ['project-a']);
  f.authority.close();
});
test('deny, malformed or swapped view, stale approval, expiry, clock regression and closure fail closed', async () => {
  for (const scenario of ['deny', 'badid', 'digest', 'extra', 'throw', 'expired', 'clock', 'closed', 'otheractor']) {
    const f = fixture();
    const operation = f.reviewer.review(f.args(s => {
      const r = f.reply(s);
      if (scenario === 'deny') r.decision = 'deny';
      if (scenario === 'badid') r.requestId = '0'.repeat(64);
      if (scenario === 'digest') r.transcript = '0'.repeat(64);
      if (scenario === 'extra') r.extra = 1;
      if (scenario === 'throw') throw new Error('not exported');
      if (scenario === 'expired') f.tick(120000);
      if (scenario === 'clock') f.tick(-1);
      if (scenario === 'closed') f.reviewer.close();
      if (scenario === 'otheractor') f.authority.confirm({ ...f.authority.pending()[0], allowProjects: ['project-a'] });
      return r;
    }));
    if (scenario === 'deny') assert.equal((await operation).status, 'denied');
    else await assert.rejects(operation, { message: 'Local pairing review rejected' });
    assert.throws(() => f.authority.redeem({ claimId: f.claim.claimId, receipt: f.claim.receipt }));
    f.reviewer.close(); f.authority.close();
  }
  const f = fixture();
  await assert.rejects(f.reviewer.review({ ...f.args(s => f.reply(s)), projects: ['other'] }));
  assert.equal(f.authority.pending().length, 0); f.authority.close();
  const g = fixture();
  await assert.rejects(g.reviewer.review({ ...g.args(() => {}), projects: ['project-a\n'] }));
  g.authority.close();
});
test('abandoned or closed presenter is bounded and its late reply cannot approve', async () => {
  const f = fixture({ reviewMs: 20 }); let snapshot, late, aborted = false;
  await assert.rejects(f.reviewer.review(f.args((s, signal) => {
    snapshot = s; signal.addEventListener('abort', () => aborted = true);
    return new Promise(r => late = r);
  })));
  assert.equal(aborted, true); late(f.reply(snapshot));
  assert.equal(f.authority.pending().length, 0); f.authority.close();
  const g = fixture();
  const operation = g.reviewer.review(g.args(() => new Promise(() => {})));
  g.reviewer.close(); await assert.rejects(operation); assert.equal(g.authority.pending().length, 0); g.authority.close();
});
test('AppKit review constructs native controls and exercises deny-default gates without human evidence', { timeout: 150000 }, async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ['probes/nsh-validation/verify-pairing-review.mjs'], { timeout: 140000 });
  const report = JSON.parse(stdout); assert.equal(report.status, 'passed'); assert.ok(report.checks >= 18);
  assert.equal(report.humanConfirmationVerified, false); assert.equal(report.phoneVerified, false);
});
