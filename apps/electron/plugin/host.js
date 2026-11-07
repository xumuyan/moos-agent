import { realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createFixtureAdapter, route } from './pi-route.js';
import { createFixtureTasks } from './pi-tasks.js';

export const name = 'moos-electron-shell';
export const inject = ['tools', 'agents', 'llm', 'sandboxPolicy', 'approval'];

export async function apply(ctx) {
  // The upstream session driver still builds a model request while PI owns
  // tool calls. Give it an empty catalogue and reject any attempted fallback.
  ctx.effect(() => ctx.tools.setExecutor({
    describe: () => ({ schemas: [], knownNames: [] }),
    async execute() {
      throw new Error('Moos 的任务工具由 PI 执行');
    },
  }));
  const runtime = process.env.MOOS_ELECTRON_PI_RUNTIME;
  if (!runtime) return;
  const load = path => import(pathToFileURL(join(runtime, path)).href);
  const [{ Store }, { Scheduler }, { runPiSdk }, { startFixture }, { privateDir }] = await Promise.all([
    load('services/agent/store.mjs'), load('services/agent/scheduler.mjs'),
    load('packages/pi-runtime/sdk-runtime.mjs'), load('services/agent/fixture.mjs'),
    load('packages/pi-adapter/index.mjs'),
  ]);
  const workspace = process.env.MOOS_ELECTRON_WORKSPACE_ROOT;
  const root = await realpath(workspace);
  const data = await realpath(dirname(workspace));
  if (root !== join(data, 'workspace')) throw new Error('PI fixture workspace must be inside its data directory');
  const dataDir = join(data, 'pi-fixture');
  await privateDir(dataDir);
  const store = new Store({ dbPath: join(dataDir, 'moos.sqlite') });
  const fixture = await startFixture({ desktopPolicy: true }).catch(error => { store.close(); throw error; });
  const provider = { id: route, model: 'moos-fixture', name: 'Moos PI', api: 'openai-completions',
    baseUrl: fixture.baseUrl, contextWindow: 128000, maxTokens: 8192 };
  const tasks = createFixtureTasks({ store, Scheduler, root,
    run: options => runPiSdk({ ...options, provider, apiKey: fixture.apiKey, dataDir: join(dataDir, 'sessions') }),
  });
  try {
    store.interruptUnfinished();
    const release = ctx.llm.registerAdapter([route], createFixtureAdapter({
      tasks, getSession: id => ctx.agents.get(id)?.session,
      getPermissions(id) {
        const agent = ctx.agents.get(id);
        if (!agent) throw new Error('PI needs an active desktop session');
        return {
          getMode: () => ctx.sandboxPolicy.resolve({ session: agent.session }).mode,
          approve: ({ id: callId, command, signal }) => {
            if (typeof command !== 'string' || command.length > 4096) return 'unavailable';
            return ctx.approval.request({ agent, callId, toolName: 'bash_escalated', reason: command, signal });
          },
        };
      },
    }));
    ctx.on('dispose', async () => {
      release();
      try { await tasks.close(); } finally { await fixture.close(); }
    });
  } catch (error) {
    try { await tasks.close(); } finally { await fixture.close(); }
    throw error;
  }
}
