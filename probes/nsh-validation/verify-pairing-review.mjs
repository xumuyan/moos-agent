// Hidden AppKit construction/action automation; NOT manual GUI or phone evidence.
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createPairingAuthority } from './pairing.mjs';
import { createPairingReviewer } from './pairing-review.mjs';
import { nativePairingPresenter } from './pairing-review-native.mjs';
process.chdir(fileURLToPath(new URL('../../', import.meta.url))); process.umask(0o077);
const base = resolve('artifacts/nsh-validation/pairing-review'); await mkdir(base, { recursive: true });
const dir = await mkdtemp(join(base, 'run-'));
try {
  execFileSync('/usr/bin/xcrun', ['swiftc', '-swift-version', '6',
    resolve('probes/nsh-validation/PairingReview.swift'), resolve('probes/nsh-validation/PairingReviewMain.swift'),
    '-o', join(dir, 'review')], { timeout: 90000, stdio: 'pipe' });
  const result = execFileSync(join(dir, 'review'), ['--self-test'], { timeout: 15000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const endpoint = 'https://127.0.0.1:12345';
  const authority = createPairingAuthority({ endpoint, caSHA256: 'a'.repeat(64), leafSHA256: 'b'.repeat(64), projects: ['project-a'] });
  try {
    const invite = authority.invite();
    const claim = authority.claim({ invitationId: invite.invitationId, secret: invite.secret, clientNonce: 'c'.repeat(64) });
    const reviewer = createPairingReviewer({ authority, endpoint });
    const outcome = await reviewer.review({ claimId: claim.claimId, projects: ['project-a'],
      present: nativePairingPresenter(join(dir, 'review'), { automationDeny: true }) });
    assert.equal(outcome.status, 'denied');
    assert.equal(authority.pending().length, 0);
    assert.throws(() => authority.redeem({ claimId: claim.claimId, receipt: claim.receipt }));
    reviewer.close();
  } finally { authority.close(); }
  console.log(JSON.stringify({ ...JSON.parse(result), nativeProcessDenialBound: true, target: 'macOS AppKit hidden control automation',
    windowShown: false, tlsConnected: false, trustPromoted: false, credentialsIssued: false }));
} finally { await rm(dir, { recursive: true, force: true }); }
