import test from 'node:test';
import { request } from 'node:https';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { createLocalPairingEntry } from './pairing-entry.mjs';
import { pairingFlowFixture } from './pairing-flow-fixture.mjs';
import { verifyPairingEntry } from './verify-pairing-entry.mjs';
const reply = (s, projects = ['project-a']) => ({ version: 1, requestId: s.requestId, decision: 'select', projects });
const present = () => { throw new Error('No review expected'); };
function call(endpoint, ca, path, body, token) {
  return new Promise((resolve, reject) => {
    const req = request(endpoint + path, { ca, method: body ? 'POST' : 'GET', timeout: 3000,
      headers: body ? { 'content-type': 'application/json' } : token ? { authorization: `Bearer ${token}` } : {} }, res => {
      let text = ''; res.on('data', b => text += b); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('test timeout'))); req.end(body ? JSON.stringify(body) : undefined);
  });
}

test('project selection precedes all network/invitation activity, binds immutable subset and is single-use', async () => {
  let snapshot, resolve, starts = 0, begins = 0, closes = 0, selected;
  const projects = ['project-a', 'project-b'];
  const entry = createLocalPairingEntry({ projects, pick: s => { snapshot = s; return new Promise(r => resolve = r); }, present,
    startFlow: async options => { starts++; selected = options.projects; return { endpoint: 'https://127.0.0.1:12345', begin: () => { begins++; return Buffer.from('test-only'); }, reviewPending: async () => 'review', close: () => { closes++; } }; } });
  projects.push('project-c'); assert.equal(starts, 0); await assert.rejects(entry.reviewPending());
  const pending = entry.begin(); await new Promise(r => setImmediate(r)); await assert.rejects(entry.begin());
  assert.equal(starts, 0); assert.equal(begins, 0); assert.ok(Object.isFrozen(snapshot.projects));
  assert.deepEqual(snapshot.projects, ['project-a', 'project-b']);
  const answer = reply(snapshot, ['project-b', 'project-a']); resolve(answer);
  const result = await pending; answer.projects.push('project-c');
  assert.deepEqual(selected, ['project-a', 'project-b']); assert.equal(starts, 1); assert.equal(begins, 1);
  assert.equal(result.status, 'invited'); assert.equal(result.material.toString(), 'test-only');
  assert.equal(await entry.reviewPending(), 'review'); await assert.rejects(entry.begin());
  await entry.close(); await entry.close(); assert.equal(closes, 1); await assert.rejects(entry.reviewPending());
});
test('deny, schema/binding/scope errors, expiry and clock failure never start a listener', async () => {
  for (const scenario of ['deny', 'empty', 'outside', 'duplicate', 'newline', 'binding', 'extra', 'throw', 'expired', 'rollback', 'nan']) {
    let tick = 10, starts = 0;
    const entry = createLocalPairingEntry({ projects: ['project-a'], selectionMs: 100,
      now: () => tick, present, startFlow: () => { starts++; throw new Error('not reached'); },
      pick: s => {
        if (scenario === 'throw') throw new Error('private failure');
        if (scenario === 'expired') tick = 110;
        if (scenario === 'rollback') tick = 9;
        if (scenario === 'nan') tick = NaN;
        const response = reply(s);
        if (scenario === 'deny') return { ...response, decision: 'deny', projects: [] };
        if (scenario === 'empty') response.projects = [];
        if (scenario === 'outside') response.projects = ['project-b'];
        if (scenario === 'duplicate') response.projects = ['project-a', 'project-a'];
        if (scenario === 'newline') response.projects = ['project-a\n'];
        if (scenario === 'binding') response.requestId = '0'.repeat(64);
        if (scenario === 'extra') response.token = 'not-allowed';
        return response;
      } });
    if (scenario === 'deny') assert.equal((await entry.begin()).status, 'cancelled');
    else await assert.rejects(entry.begin(), /Local pairing entry rejected/);
    assert.equal(starts, 0); await assert.rejects(entry.begin()); await entry.close();
  }
});
test('abandonment, close before presentation, late selection and late start completion cannot create a usable invitation', async () => {
  let calls = 0;
  const early = createLocalPairingEntry({ projects: ['project-a'], present, pick: () => { calls++; } });
  const p = early.begin(); await early.close(); await assert.rejects(p); assert.equal(calls, 0);
  for (const closeExplicitly of [false, true]) {
    let snapshot, resolve, aborted = false, starts = 0;
    const entry = createLocalPairingEntry({ projects: ['project-a'], present, selectionMs: 30,
      startFlow: () => { starts++; }, pick: (s, signal) => { snapshot = s; signal.addEventListener('abort', () => aborted = true); return new Promise(r => resolve = r); } });
    const pending = entry.begin(); const rejected = assert.rejects(pending);
    await new Promise(r => setImmediate(r)); if (closeExplicitly) await entry.close();
    await rejected; resolve(reply(snapshot)); await new Promise(r => setImmediate(r));
    assert.equal(aborted, true); assert.equal(starts, 0); await entry.close();
  }
  let startsOnAbort = 0, reentrant;
  reentrant = createLocalPairingEntry({ projects: ['project-a'], present,
    pick: (s, signal) => { signal.addEventListener('abort', () => { void reentrant.close(); }); return reply(s); },
    startFlow: () => { startsOnAbort++; } });
  await assert.rejects(reentrant.begin()); assert.equal(startsOnAbort, 0);
  let finish, begins = 0, closes = 0;
  const entry = createLocalPairingEntry({ projects: ['project-a'], present, pick: s => reply(s),
    startFlow: () => new Promise(r => finish = r) });
  const pending = entry.begin(); await new Promise(r => setImmediate(r)); await entry.close();
  finish({ begin: () => begins++, close: () => closes++ }); await assert.rejects(pending);
  assert.equal(begins, 0); assert.equal(closes, 1);
});
test('invalid local setup and failed factory/material generation fail closed without reusable entry', async () => {
  const base = { projects: ['project-a'], pick: s => reply(s), present };
  for (const patch of [{ projects: [] }, { projects: ['project-a', 'project-a'] }, { projects: ['project-a\n'] },
    { selectionMs: true }, { selectionMs: 60001 }, { sessionMs: 120001 }, { pick: null }, { present: null }]) {
    assert.throws(() => createLocalPairingEntry({ ...base, ...patch }));
  }
  for (const clock of [() => NaN, () => -1, () => { throw new Error('clock detail'); }]) {
    let calls = 0;
    const entry = createLocalPairingEntry({ ...base, now: clock, pick: () => calls++ });
    await assert.rejects(entry.begin(), /^Error: Local pairing entry rejected$/); assert.equal(calls, 0);
  }
  const rejected = createLocalPairingEntry({ ...base, startFlow: async () => { throw new Error('factory detail'); } });
  await assert.rejects(rejected.begin(), /^Error: Local pairing entry rejected$/); await assert.rejects(rejected.begin());
  let closes = 0;
  const failedMaterial = createLocalPairingEntry({ ...base, startFlow: async () => ({
    begin: () => { throw new Error('material detail'); }, close: () => closes++
  }) });
  await assert.rejects(failedMaterial.begin(), /^Error: Local pairing entry rejected$/);
  await failedMaterial.close(); assert.equal(closes, 1);
});
test('selected subset starts the real loopback flow and material only after explicit local selection', { timeout: 60000 }, async () => {
  const f = await pairingFlowFixture(); let entry;
  try {
    entry = createLocalPairingEntry({ tls: f.tls, projects: ['project-a', 'project-b'], pick: s => reply(s, ['project-b']),
      present: s => ({ version: 1, requestId: s.requestId, claimId: s.claimId, transcript: s.transcript, decision: 'approve' }) });
    const result = await entry.begin(); assert.equal(result.status, 'invited');
    assert.match(result.endpoint, /^https:\/\/127\.0\.0\.1:[0-9]+$/); assert.ok(result.material.toString().startsWith('N01BOOT1\n'));
    await assert.rejects(entry.reviewPending());
    const fields = result.material.toString('ascii').split('\n');
    const claim = await call(result.endpoint, f.tls.ca, '/v1/pairing/claim', { invitationId: fields[5], secret: fields[6], clientNonce: randomBytes(32).toString('hex') });
    assert.equal(claim.status, 200); assert.equal((await entry.reviewPending()).status, 'approved'); // Programmatic approval, NOT human evidence.
    const credential = await call(result.endpoint, f.tls.ca, '/v1/pairing/redeem', { claimId: claim.body.claimId, receipt: claim.body.receipt });
    assert.equal(credential.status, 200); assert.deepEqual(credential.body.projects, ['project-b']);
    const check = p => call(result.endpoint, f.tls.ca, `/v1/projects/${p}/check`, undefined, credential.body.token);
    assert.equal((await check('project-b')).status, 200); assert.equal((await check('project-a')).status, 404);
    await entry.close(); await assert.rejects(check('project-b'));
  } finally { await entry?.close(); await f.close(); }
});
test('AppKit project picker defaults to no grant and native denial starts no flow', { timeout: 120000 }, async () => {
  const report = await verifyPairingEntry(); assert.equal(report.status, 'passed'); assert.equal(report.nativeProcessDenialBound, true);
  for (const key of ['windowShown', 'listenerStarted', 'invitationCreated', 'phoneVerified', 'humanSelectionVerified', 'humanConfirmationVerified']) assert.equal(report[key], false);
});
