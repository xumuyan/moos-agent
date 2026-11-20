/** Build-local persistent synthetic Host. Profile is a fixed sibling of this staged entry. */
import { fileURLToPath } from 'node:url';
import { startDesktopHost } from './desktop-host.mjs';
import { serveDesktopPipe } from './desktop-host-stdio.mjs';

const profileDir = fileURLToPath(new URL('./profile', import.meta.url));
if (process.stdin.isTTY || process.argv.length !== 2) {
  process.stderr.write('Private persistent desktop pipe required\n');
  process.exitCode = 1;
} else {
  process.umask(0o077);
  const stop = () => process.stdin.destroy();
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  try {
    const result = await serveDesktopPipe({ start: async () => {
      try { return await startDesktopHost({ profileDir }); }
      catch { process.stderr.write('Persistent desktop Host refused to open its isolated profile\n'); throw new Error('Profile unavailable'); }
    } });
    if (result.failed) process.exitCode = 1;
  } catch { process.stderr.write('Persistent desktop Host cleanup failed\n'); process.exitCode = 1; }
  finally { process.off('SIGTERM', stop); process.off('SIGINT', stop); }
}
