// Fixed entry for the isolated, explicitly enabled dual-provider candidate.
import { serveDesktopPipe } from './desktop-host-stdio.mjs';
import { startDesktopHost } from './desktop-host.mjs';
import { loadLiveModels } from './desktop-live-models.mjs';

if (process.stdin.isTTY || process.argv.length !== 2) {
  process.stderr.write('Private desktop pipe required\n'); process.exitCode = 1;
} else {
  const stop = () => process.stdin.destroy();
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  try {
    const start = async () => {
      try { return await startDesktopHost({ liveModels: await loadLiveModels() }); }
      catch {
        process.stderr.write('Isolated desktop model Host startup failed; check private configuration and permissions\n');
        throw new Error('Isolated desktop model Host startup failed');
      }
    };
    if ((await serveDesktopPipe({ start })).failed) process.exitCode = 1;
  } catch {
    process.stderr.write('Isolated desktop model Host cleanup failed\n');
    process.exitCode = 1;
  } finally {
    process.off('SIGTERM', stop); process.off('SIGINT', stop);
  }
}
