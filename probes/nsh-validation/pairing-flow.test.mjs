import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:https';
import { randomBytes } from 'node:crypto';
import { pairingFlowFixture } from './pairing-flow-fixture.mjs';
import { startLocalPairingFlow } from './pairing-flow.mjs';
import { verifyPairingFlow } from './verify-pairing-flow.mjs';
const reply = (s, decision = 'approve') => ({ version: 1, requestId: s.requestId, claimId: s.claimId, transcript: s.transcript, decision });
function call(endpoint, ca, path, body, token) {
  return new Promise((resolve, reject) => {
    const req = request(endpoint + path, { ca, method: body ? 'POST' : 'GET', timeout: 3000,
      headers: body ? { 'content-type': 'application/json' } : token ? { authorization: `Bearer ${token}` } : {} }, res => {
      let text = ''; res.on('data', b => text += b); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('test request timeout')));
    req.end(body ? JSON.stringify(body) : undefined);
  });
}
function material(bytes) {
  const fields = bytes.toString('ascii').split('\n');
  return { invitationId: fields[5], secret: fields[6], clientNonce: randomBytes(32).toString('hex') };
}
test('explicit local flow binds one invitation, immutable grants, one review and bounded credential scope', { timeout: 60000 }, async () => {
  const f = await pairingFlowFixture(); let flow;
  try {
    const projects = ['project-a']; let snapshot, respond, calls = 0, tick = 0;
    flow = await startLocalPairingFlow({ tls: f.tls, projects, now: () => tick, present: s => { calls++; snapshot = s; return new Promise(r => respond = r); } });
    projects.push('project-b');
    await assert.rejects(flow.reviewPending());
    const bootstrap = flow.begin(); assert.throws(() => flow.begin());
    await assert.rejects(flow.reviewPending()); // Not claimed yet; doesn't consume local review action.
    const claimed = await call(flow.endpoint, f.tls.ca, '/v1/pairing/claim', material(bootstrap));
    assert.equal(claimed.status, 200); assert.equal(calls, 0); // A remote claim never opens/approves a panel itself.
    const claim = claimed.body, redeem = () => call(flow.endpoint, f.tls.ca, '/v1/pairing/redeem', { claimId: claim.claimId, receipt: claim.receipt });
    assert.equal((await redeem()).status, 409);
    assert.equal((await call(flow.endpoint, f.tls.ca, '/v1/pairing/confirm', {})).status, 404);
    const reviewing = flow.reviewPending(); await new Promise(r => setImmediate(r));
    await assert.rejects(flow.reviewPending()); assert.equal(calls, 1);
    assert.equal(snapshot.transcript, claim.transcript); assert.deepEqual(snapshot.projects, ['project-a']);
    respond(reply(snapshot)); assert.equal((await reviewing).status, 'approved');
    await assert.rejects(flow.reviewPending());
    const credential = await redeem(); assert.equal(credential.status, 200);
    assert.deepEqual(credential.body.projects, ['project-a']); assert.equal((await redeem()).status, 403);
    const check = p => call(flow.endpoint, f.tls.ca, `/v1/projects/${p}/check`, undefined, credential.body.token);
    assert.equal((await check('project-a')).status, 200); assert.equal((await check('project-b')).status, 404);
    tick = 120000; // No local action or timer has run: the HTTP authority itself enforces the whole-flow deadline.
    assert.equal((await check('project-a')).status, 503);
    tick = 0; assert.equal((await check('project-a')).status, 503); // Never recover after invalidation.
    await flow.close(); await flow.close(); await assert.rejects(check('project-a')); assert.throws(() => flow.begin());
  } finally { await flow?.close(); await f.close(); }
});
test('denial, cancellation, abandoned view, expiry and clock rollback close the whole disposable flow', { timeout: 60000 }, async () => {
  const f = await pairingFlowFixture();
  try {
    for (const scenario of ['deny', 'close', 'malformed', 'expiry', 'rollback', 'nan', 'clock-throws', 'abandoned']) {
      let flow, tick = 0, resolve, displayed, aborted = false;
      try {
        flow = await startLocalPairingFlow({ tls: f.tls, projects: ['project-a'], sessionMs: scenario === 'abandoned' ? 1000 : 10000,
          now: () => { if (tick === 'throw') throw new Error('test clock unavailable'); return tick; }, present: (s, signal) => {
            displayed = s; signal.addEventListener('abort', () => aborted = true);
            if (scenario === 'close' || scenario === 'abandoned') return new Promise(r => resolve = r);
            if (scenario === 'expiry') tick = 10000;
            if (scenario === 'rollback') tick = -1;
            if (scenario === 'nan') tick = NaN;
            if (scenario === 'clock-throws') tick = 'throw';
            return scenario === 'malformed' ? { ...reply(s), extra: true } : reply(s, scenario === 'deny' ? 'deny' : 'approve');
          } });
        const claim = await call(flow.endpoint, f.tls.ca, '/v1/pairing/claim', material(flow.begin())); assert.equal(claim.status, 200);
        const reviewing = flow.reviewPending();
        if (scenario === 'close') { await new Promise(r => setImmediate(r)); await flow.close(); }
        if (scenario === 'deny') assert.equal((await reviewing).status, 'denied');
        else await assert.rejects(reviewing);
        if (resolve) resolve(reply(displayed)); // Late approval cannot reopen a closed listener or claim.
        assert.equal(aborted, true); await assert.rejects(flow.reviewPending()); assert.throws(() => flow.begin());
        await assert.rejects(call(flow.endpoint, f.tls.ca, '/v1/pairing/redeem', { claimId: claim.body.claimId, receipt: claim.body.receipt }));
      } finally { await flow?.close(); }
    }
    let time = 0;
    const flow = await startLocalPairingFlow({ tls: f.tls, projects: ['project-a'], now: () => time, sessionMs: 100, present: s => reply(s) });
    time = 100; assert.throws(() => flow.begin()); await flow.close();
    for (const projects of [['project-a\n'], ['a', 'a'], []]) await assert.rejects(startLocalPairingFlow({ tls: f.tls, projects, present: s => reply(s) }));
  } finally { await f.close(); }
});
test('real Swift HTTPS candidate and AppKit denial integrate with the local lifecycle, not phone/human trust', { timeout: 240000 }, async () => {
  const report = await verifyPairingFlow();
  assert.equal(report.status, 'passed'); assert.equal(report.nativeProcessDenialBound, true);
  assert.equal(report.nativeClaimOverHTTPS, true); assert.equal(report.nativeRedeemOverHTTPS, true);
  for (const key of ['phoneVerified', 'humanConfirmationVerified', 'windowShown', 'systemTrustChanged', 'taskServerConnected', 'credentialsPersisted']) assert.equal(report[key], false);
});
