import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { statSync, unwatchFile, watchFile, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createPiTasks } from './pi-tasks.js';
import { piModels } from './pi-models.js';

export const name = 'moos-electron-shell';
export const inject = ['tools', 'agents', 'llm', 'sandboxPolicy', 'approval'];

// 二进制或超大附件落入会话工作区，PI 工具可用相对路径读取；不写入工作区之外。
export async function saveWorkspaceUpload(bytes, name, cwd, mkdir, writeFile) {
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw new Error('PI uploads need a workspace directory');
  const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
  const leaf = name.replace(/[\\/\u0000-\u001f]/gu, '_').replace(/^\.+/, '_').slice(0, 80) || 'file';
  const dir = join(cwd, '.moos-uploads');
  await mkdir(dir, { recursive: true });
  const target = join(dir, `${digest}-${leaf}`);
  await writeFile(target, bytes);
  return `.moos-uploads/${digest}-${leaf}`;
}

export async function apply(ctx) {
  // The upstream session driver still builds a model request while PI owns
  // tool calls. Give it an empty catalogue and reject any attempted fallback.
  ctx.effect(() => ctx.tools.setExecutor({
    describe: () => ({ schemas: [], knownNames: [] }),
    async execute() {
      throw new Error('沐码的任务工具由 PI 执行');
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
  const fixtureProvider = fixture && { id: route, model: 'moos-fixture', name: '沐码 PI', api: 'openai-completions',
    baseUrl: fixture.baseUrl, contextWindow: 128000, maxTokens: 8192 };
  const models = fixture ? undefined : piModels(data, checkedProvider);
  // 设置页「命令执行」覆盖：danger-full-access 时 PI 命令不加 seatbelt 沙箱（Codex 式完全权限），
  // 未配置时回退 DSH sandboxPolicy（deployment 默认 workspace-write）。每次任务启动时同步
  // 重读一次（mtime/size 变化才重读），避免依赖异步文件事件的不确定性。
  let executionMode = null;
  let policyStamp = '';
  const policyPath = join(data, 'private/execution-policy.json');
  const refreshPolicy = () => {
    if (!models) return;
    try {
      const stats = statSync(policyPath);
      const stamp = stats.mtimeMs + ':' + stats.size;
      if (stamp === policyStamp) return;
      policyStamp = stamp;
      const rows = JSON.parse(readFileSync(policyPath, 'utf8'));
      executionMode = rows.mode === 'workspace-write' || rows.mode === 'danger-full-access' ? rows.mode : null;
    } catch {
      executionMode = null;
      policyStamp = '';
    }
  };
  const tasks = createPiTasks({ store, Scheduler, fixtureRoot: fixture ? root : undefined, dataRoot: data,
    async run(options) {
      const provider = fixtureProvider ?? options.provider;
      const apiKey = fixture?.apiKey ?? await models.credential(provider);
      let imageGen;
      if (models) imageGen = await models.imageGen().catch(() => null);
      let backup;
      if (models && options.backup) {
        const key = await models.credential(options.backup.provider).catch(() => undefined);
        if (key) backup = { ...options.backup, apiKey: key };
      }
      return runPiSdk({ ...options, provider, apiKey, dataDir: join(dataDir, 'sessions'),
        // M06 桌面工具：包内 Resources/bin 的 Swift helper；开发检出不打包时文件不存在，工具自动不挂载。
        desktop: { helperPath: process.env.MOOS_DESKTOP_HELPER
          || resolve(dirname(fileURLToPath(import.meta.url)), '../../bin/moos-desktop-helper') },
        // 设置页图片服务配置优先；未配置时 sdk-runtime 回退读 private/image-gen.json（无则不挂载工具）。
        ...(models ? { imageGen: imageGen ?? null } : {}), routing: { backup } });
    },
  });
  try {
    store.interruptUnfinished();
    ctx.on('agent/created', async ({ agent }) => {
      await tasks.inheritTurns(agent.session);
    }, { global: true });
    const release = ctx.llm.registerAdapter([route], createPiAdapter({
      tasks, models, getSession: id => ctx.agents.get(id)?.session,
      readFile: (ref, signal) => ctx.get('attachments')?.readFileStream(ref, signal),
      readImage: (ref, signal) => ctx.get('attachments')?.readImage(ref, signal),
      // 二进制或超大附件落入会话工作区，PI 工具可用相对路径读取；不写入工作区之外。
      saveUpload: async (bytes, name, cwd, signal) => {
        signal?.throwIfAborted();
        return saveWorkspaceUpload(bytes, name, cwd, mkdir, writeFile);
      },
      getTurnStart: session => session && ctx.agents.turnBoundaryOf(session).openTurnStartSeq,
      getPermissions(id) {
        refreshPolicy();
        const agent = ctx.agents.get(id);
        if (!agent) throw new Error('PI needs an active desktop session');
        return {
          getMode: () => executionMode ?? ctx.sandboxPolicy.resolve({ session: agent.session }).mode,
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
