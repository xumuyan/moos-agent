// Hidden AppKit controls + real denial subprocess; no automatic native selection.
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createLocalPairingEntry } from './pairing-entry.mjs';
import { nativePairingPresenter as nativeProjectPicker } from './pairing-review-native.mjs';
export async function verifyPairingEntry() {
  const base = resolve('artifacts/nsh-validation/pairing-entry'); await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, 'run-'));
  const { chmod } = await import('node:fs/promises'); await chmod(dir, 0o700);
  let entry;
  try {
    execFileSync('/usr/bin/xcrun', ['swiftc', '-swift-version', '6',
      resolve('probes/nsh-validation/PairingEntry.swift'), resolve('probes/nsh-validation/PairingEntryMain.swift'),
      '-o', join(dir, 'picker')], { timeout: 90000, stdio: 'pipe' });
    const result = JSON.parse(execFileSync(join(dir, 'picker'), ['--self-test'], { timeout: 15000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    let starts = 0;
    entry = createLocalPairingEntry({ projects: ['project-a', 'project-b'],
      pick: nativeProjectPicker(join(dir, 'picker'), { automationDeny: true }), present: () => { throw new Error('Not reached'); },
      startFlow: () => { starts++; throw new Error('Not reached'); } });
    assert.deepEqual(await entry.begin(), { version: 1, status: 'cancelled' });
    assert.equal(starts, 0); await assert.rejects(entry.begin()); await entry.close();
    return { ...result, nativeProcessDenialBound: true, listenerStarted: false, invitationCreated: false,
      phoneVerified: false, humanConfirmationVerified: false, taskServerConnected: false };
  } finally { await entry?.close(); await rm(dir, { recursive: true, force: true }); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await verifyPairingEntry()));
