// Integrated loopback check: real Swift HTTPS candidate + local orchestration + native denial.
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { pairingFlowFixture } from './pairing-flow-fixture.mjs';
import { startLocalPairingFlow } from './pairing-flow.mjs';
import { nativePairingPresenter } from './pairing-review-native.mjs';
export async function verifyPairingFlow() {
  const f = await pairingFlowFixture(); let flow, child, exited, timer;
  try {
    const sources = name => resolve('probes/nsh-validation', name);
    execFileSync('/usr/bin/xcrun', ['swiftc', '-swift-version', '6', ...['PinnedTLS.swift', 'Bootstrap.swift', 'PairingFlowCheck.swift'].map(sources), '-o', join(f.dir, 'peer')], { timeout: 90000, stdio: 'pipe' });
    execFileSync('/usr/bin/xcrun', ['swiftc', '-swift-version', '6', ...['PairingReview.swift', 'PairingReviewMain.swift'].map(sources), '-o', join(f.dir, 'review')], { timeout: 90000, stdio: 'pipe' });
    for (const decision of ['approved', 'denied']) {
      let comparison;
      flow = await startLocalPairingFlow({ tls: f.tls, projects: ['project-a'], present: async (snapshot, signal) => {
        assert.equal(snapshot.transcript, comparison); assert.deepEqual(snapshot.projects, ['project-a']);
        assert.equal(snapshot.secret, undefined); assert.equal(snapshot.receipt, undefined);
        if (decision === 'denied') return nativePairingPresenter(join(f.dir, 'review'), { automationDeny: true })(snapshot, signal);
        // Trusted-local TEST response, not a GUI approval or actual user comparison.
        return { version: 1, requestId: snapshot.requestId, claimId: snapshot.claimId, transcript: snapshot.transcript, decision: 'approve' };
      } });
      await writeFile(join(f.dir, 'bootstrap.bin'), flow.begin(), { mode: 0o600 });
      child = spawn(join(f.dir, 'peer'), [f.dir], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = ''; child.stdout.on('data', x => { stdout += x; if (stdout.length > 4096) child.kill('SIGTERM'); });
      child.stderr.on('data', () => {});
      exited = once(child, 'close'); void exited.catch(() => {});
      timer = setTimeout(() => child.kill('SIGTERM'), 35000);
      for (let i = 0; i < 250; i++) {
        try { comparison = await readFile(join(f.dir, 'comparison'), 'utf8'); break; } catch {}
        await new Promise(r => setTimeout(r, 100));
      }
      assert.match(comparison ?? '', /^[a-f0-9]{64}$/);
      const outcome = await flow.reviewPending(); assert.equal(outcome.status, decision);
      await writeFile(join(f.dir, 'decision.tmp'), outcome.status, { mode: 0o600 });
      await rename(join(f.dir, 'decision.tmp'), join(f.dir, 'decision'));
      assert.equal((await exited)[0], 0); clearTimeout(timer); child = undefined;
      const report = JSON.parse(stdout); assert.equal(report.status, 'passed'); assert.equal(report.decision, decision);
      await assert.rejects(flow.reviewPending()); await flow.close(); flow = undefined;
      const { rm } = await import('node:fs/promises');
      for (const name of ['comparison', 'decision', 'bootstrap.bin']) await rm(join(f.dir, name));
    }
    return { status: 'passed', nativeClaimOverHTTPS: true, nativeRedeemOverHTTPS: true,
      nativeProcessDenialBound: true, automatedApprovalOnly: true, opaqueCredentialInNativeMemoryOnly: true,
      phoneVerified: false, humanConfirmationVerified: false, windowShown: false,
      systemTrustChanged: false, taskServerConnected: false, credentialsPersisted: false };
  } finally {
    clearTimeout(timer); child?.kill('SIGTERM'); await flow?.close();
    // Never remove a running peer's files; bounded wait, retain directory on failed shutdown.
    if (child && await Promise.race([exited.then(() => true, () => true), new Promise(r => setTimeout(() => r(false), 3000))]) === false) {
      throw new Error('Pairing flow peer shutdown incomplete; temporary state retained');
    }
    await f.close();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await verifyPairingFlow()));
