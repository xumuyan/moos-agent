import { realpath } from 'node:fs/promises';
import { unwatchFile, watchFile } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPiTasks } from './pi-tasks.js';
import { piModels } from './pi-models.js';

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
  const { createPiAdapter, route } = await import(
    pathToFileURL(join(runtime, '../host-runtime/dsh/moos-pi/pi-route.js')).href);
  ctx.on('agent/created', ({ agent }) => {
    if (agent.model.current()?.provider !== route) {
      agent.model.select({ provider: route, model: 'auto' });
    }
  }, { global: true });
  const load = path => import(pathToFileURL(join(runtime, path)).href);
  const [{ Store }, { Scheduler }, { runPiSdk }, { privateDir, checkedProvider }] = await Promise.all([
    load('services/agent/store.mjs'), load('services/agent/scheduler.mjs'),
    load('packages/pi-runtime/sdk-runtime.mjs'), load('packages/pi-adapter/index.mjs'),
  ]);
  const fixtureMode = process.env.MOOS_ELECTRON_PI_FIXTURE_MODE === '1';
  const workspace = process.env.MOOS_ELECTRON_WORKSPACE_ROOT;
  const root = await realpath(workspace);
  const data = await realpath(dirname(workspace));
  if (root !== join(data, 'workspace')) throw new Error('PI workspace must be inside its data directory');
  const dataDir = join(data, fixtureMode ? 'pi-fixture' : 'pi');
  await privateDir(dataDir);
  const store = new Store({ dbPath: join(dataDir, 'moos.sqlite') });
  let fixture;
  if (fixtureMode) {
    try {
      const { startFixture } = await load('services/agent/fixture.mjs');
      fixture = await startFixture({ desktopPolicy: true });
    } catch (error) { store.close(); throw error; }
  }
  const fixtureProvider = fixture && { id: route, model: 'moos-fixture', name: 'Moos PI', api: 'openai-completions',
    baseUrl: fixture.baseUrl, contextWindow: 128000, maxTokens: 8192 };
  const models = fixture ? undefined : piModels(data, checkedProvider);
  const tasks = createPiTasks({ store, Scheduler, fixtureRoot: fixture ? root : undefined, dataRoot: data,
    async run(options) {
      const provider = fixtureProvider ?? options.provider;
      const apiKey = fixture?.apiKey ?? await models.credential(provider);
      let backup;
      if (models && options.backup) {
        const key = await models.credential(options.backup.provider).catch(() => undefined);
        if (key) backup = { ...options.backup, apiKey: key };
      }
      return runPiSdk({ ...options, provider, apiKey, dataDir: join(dataDir, 'sessions'), routing: { backup } });
    },
  });
  try {
    store.interruptUnfinished();
    const release = ctx.llm.registerAdapter([route], createPiAdapter({
      tasks, models, getSession: id => ctx.agents.get(id)?.session,
      readFile: (ref, signal) => ctx.get('attachments')?.readFileStream(ref, signal),
      readImage: (ref, signal) => ctx.get('attachments')?.readImage(ref, signal),
      getTurnStart: session => session && ctx.agents.turnBoundaryOf(session).openTurnStartSeq,
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
    const profilePath = join(data, 'providers.json');
    const refresh = () => ctx.emit('llm/models-updated', route);
    if (models) watchFile(profilePath, { persistent: false, interval: 500 }, refresh);
    ctx.on('dispose', async () => {
      if (models) unwatchFile(profilePath, refresh);
      release();
      try { await tasks.close(); } finally { await fixture?.close(); }
    });
  } catch (error) {
    try { await tasks.close(); } finally { await fixture?.close(); }
    throw error;
  }
}
