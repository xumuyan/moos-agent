import { delimiter, join } from 'node:path';
import { runCli } from './dsh/node_modules/@deepseek-ai/dsh/lib/bin.js';

const runtime = join(import.meta.dirname, 'runtime');
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
