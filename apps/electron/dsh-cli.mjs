import { delimiter, join } from 'node:path';
import { runCli } from './dsh/node_modules/@deepseek-ai/dsh/lib/bin.js';

const runtime = join(import.meta.dirname, 'runtime');
if (process.env.MOOS_ELECTRON_PARENT_PIPE === '1') {
  delete process.env.MOOS_ELECTRON_PARENT_PIPE;
  // The desktop keeps stdin open. EOF also arrives after a forced exit,
  // and SIGTERM lets the Host dispose the scheduler and its detached tools.
  process.stdin.once('end', () => process.kill(process.pid, 'SIGTERM'));
  process.stdin.resume();
}
await runCli({
  manageDesktopProfile: true,
  packageManager: {
    command: process.execPath,
    args: ['--expose-internals', join(runtime, 'primary-runtime/dependencies/pnpm/bin/pnpm.mjs')],
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      DSH_DESKTOP_NODE_EXECUTABLE: process.execPath,
      PATH: join(runtime, 'bin') + delimiter + (process.env.PATH ?? ''),
    },
  },
});
