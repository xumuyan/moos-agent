/** Fixed private stdio entry, only for the signed, offline synthetic candidate. */
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { verifyProfileEntry } from './desktop-profile.mjs';
import { startDesktopHost } from './desktop-host.mjs';
import { serveDesktopPipe } from './desktop-host-stdio.mjs';

async function profile() {
  const { check } = JSON.parse(await readFile(new URL('../../package-mode.json', import.meta.url), 'utf8'));
  if (typeof check !== 'boolean') throw Error('Invalid bundle mode');
  const root = check ? dirname(dirname(dirname(dirname(process.execPath)))) :
    join(homedir(), 'Library', 'Application Support', 'dev.muma.probe.nsh.package');
  const path = join(root, 'profile');
  await verifyProfileEntry(root, true);
  // startDesktopHost independently validates the canonical, private profile and lease.
  return path;
}

if (process.stdin.isTTY || process.argv.length !== 2) {
  process.stderr.write('Private candidate pipe required\n');
  process.exitCode = 1;
} else {
  process.umask(0o077);
  const stop = () => process.stdin.destroy();
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  try {
    const result = await serveDesktopPipe({ start: async () => startDesktopHost({ profileDir: await profile() }) });
    if (result.failed) process.exitCode = 1;
  } catch {
    process.stderr.write('Offline candidate Host failed\n');
    process.exitCode = 1;
  } finally { process.off('SIGTERM', stop); process.off('SIGINT', stop); }
}
