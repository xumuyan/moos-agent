import { lstat, readFile, realpath } from 'node:fs/promises';
import { resolve, join, isAbsolute, basename } from 'node:path';
import {
  createAgentSession, createExtensionRuntime, ModelRuntime,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { Agent as UndiciAgent, setGlobalDispatcher } from 'undici';
import { checkedProvider, context, privateDir, privateFile, proxyFor } from '../pi-adapter/index.mjs';
import { classifyTaskError, TaskFailure } from '../../services/agent/errors.mjs';
import { ALLOWED_TASK_TIMEOUTS, taskTimeout } from '../../services/agent/task-policy.mjs';
import { normalizeUsage } from '../../services/agent/usage.mjs';
import { workspaceTools } from './tool-policy.mjs';
import { createImageTool } from './image-tool.mjs';
import { createDesktopTools } from './desktop-tools.mjs';
import { repairRouting } from './repair-routing.mjs';
import { openPiSession } from './session-fork.mjs';

const busy = new Set();
const transportTimeoutMs = ALLOWED_TASK_TIMEOUTS.at(-1);
const retryPrompt = '继续上一次未完成的任务。先核对当前工作区和已有工具结果，再完成剩余步骤。已经成功的操作无需重做。';

// Node's built-in fetch otherwise aborts while waiting for response headers at
// five minutes, before PI's request timeout is reached. The shared transport is
// bounded at the product maximum; each task still has its own shorter abort
// signal and exact selected deadline.
setGlobalDispatcher(new UndiciAgent({ headersTimeout: transportTimeoutMs, bodyTimeout: transportTimeoutMs }));

function resourceLoader(instructions) {
  const runtime = createExtensionRuntime();
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => instructions,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

export function sdkSettings(duration) {
  // P03.13.18：压缩预留从默认 16384 提高到 32768。默认阈值（窗口-16k）下长任务一轮内就能把上下文
  // 推过窗口边缘，压缩的总结请求自身也会超限，形成死锁（生产 codex-weixin-notifier 会话连续三个任务失败）。
  // 提前在约 76% 处压缩，总结请求保有 ~29k 余量；keepRecentTokens 保持默认保留近期原文。
  return SettingsManager.inMemory({ httpIdleTimeoutMs: taskTimeout(duration),
    compaction: { enabled: true, reserveTokens: 32768, keepRecentTokens: 20000 },
    retry: { enabled: false, provider: { timeoutMs: taskTimeout(duration) } } });
}

/** Sum of the last assistant usage fields PI reports for a turn (input + cache + output). */
export function contextTokensUsed(usage) {
  if (!usage || typeof usage !== 'object') return 0;
  const field = value => (Number.isSafeInteger(value) && value > 0 ? value : 0);
  return field(usage.input) + field(usage.cacheRead) + field(usage.cacheWrite) + field(usage.output);
}

/** Compaction head-room kept for the summarize request itself when pre-compacting (P03.13.18). */
export const PRE_COMPACT_MARGIN_TOKENS = 40960;

function validate({ task, project, conversation, dataDir, apiKey }) {
  if (!conversation || typeof conversation.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(conversation.id)) throw new Error('Invalid conversation id');
  const message = typeof task === 'string' ? task : task?.text;
  const duration = taskTimeout(typeof task === 'object' ? task.timeoutMs : undefined);
  if (typeof message !== 'string' || !message.trim() || Buffer.byteLength(message) > 1024 * 1024) throw new Error('Invalid task');
  if (typeof apiKey !== 'string' || !apiKey || apiKey.length > 16384 || /[\r\n\x00]/.test(apiKey)) throw new Error('Invalid API key');
  if (!project || !isAbsolute(project.path) || !isAbsolute(dataDir)) throw new Error('Absolute project and dataDir required');
  return { message, duration };
}

/** Run a PI task in the existing Node host through the official SDK; no per-task Node process. */
export async function runPiSdk({ task, project, conversation, signal, emit = () => {}, provider, dataDir, apiKey, permissions, routing, retry, fork, captureCheckpoint, images, imageGen, desktop }) {
  const upstream = checkedProvider(provider);
  const { message, duration } = validate({ task, project, conversation, dataDir, apiKey });
  if (images?.length && !provider.imageInput) throw new TaskFailure('model_capability');
  const cwd = await realpath(project.path);
  const root = resolve(dataDir, conversation.id);
  if (busy.has(root) || busy.has(cwd)) throw new Error('Project or conversation already running');
  busy.add(root); busy.add(cwd);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; abort(); }, duration);
  const aborted = () => new TaskFailure(timedOut ? 'timeout' : 'cancelled');
  const routes = new Map();
  let session; let unsubscribe; let desktopTools;
  try {
    if (controller.signal.aborted) throw aborted();
    await privateDir(dataDir); await privateDir(root);
    const agentDir = join(root, 'agent');
    await privateDir(agentDir);
    const instructions = await context(cwd);
    const modelsPath = join(agentDir, 'models.json');
    const configs = {};
    async function add(profile, baseUrl, key) {
      const proxy = await proxyFor(profile, baseUrl, key);
      const thinkingLevel = profile.thinkingLevel ?? 'off';
      routes.set(profile.id, { profile, proxy, thinkingLevel });
      configs[profile.id] = {
        baseUrl: proxy.baseUrl, api: profile.api, authHeader: true,
        ...(profile.service === 'glm' ? { compat: { thinkingFormat: 'zai', supportsReasoningEffort: false } } : {}),
        models: [{ id: profile.model, name: profile.name, reasoning: thinkingLevel !== 'off' || profile.service === 'glm',
          input: profile.imageInput ? ['text', 'image'] : ['text'],
          // GLM Responses 真实档位只有 low/high/max；off 显式发送 effort none 放弃思考，旧档位由 PI clamp 归一到最近官方档。
          ...(profile.service === 'glm'
            ? { thinkingLevelMap: { off: 'none', minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: 'max' } }
            : thinkingLevel === 'xhigh' ? { thinkingLevelMap: { xhigh: 'xhigh' } } : {}),
          contextWindow: profile.contextWindow, maxTokens: profile.maxTokens,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
      };
    }
    await add(provider, upstream, apiKey);
    if (routing?.backup && routing.backup.provider.id !== provider.id && (!images?.length || routing.backup.provider.imageInput)) {
      validate({ task, project, conversation, dataDir, apiKey: routing.backup.apiKey });
      await add(routing.backup.provider, checkedProvider(routing.backup.provider), routing.backup.apiKey);
    }
    await privateFile(modelsPath, JSON.stringify({ providers: configs }));
    const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath, refreshOnCreate: false });
    for (const [id, entry] of routes) {
      await modelRuntime.setRuntimeApiKey(id, entry.proxy.token);
      entry.model = modelRuntime.getModel(id, entry.profile.model);
      if (!entry.model) throw new Error('PI SDK model unavailable');
    }
    const primary = routes.get(provider.id);
    const sessionManager = await openPiSession({ cwd, root, dataDir, fork, model: primary.model });
    const backup = routes.get(routing?.backup?.provider.id);
    const repair = backup && routing.backup.repair ? repairRouting() : undefined;
    let active = primary;
    let text = ''; let last; let lastFailure; let progressed = false;
    const switched = (reason) => {
      active = backup;
      emit('model_route', { from: primary.profile.name, to: backup.profile.name, reason });
    };
    const defaultToolNames = ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls'];
    async function createSession() {
      const base = permissions && workspaceTools(cwd, permissions);
      // 图片服务未配置时 createImageTool 返回 null，模型看不到该工具；配置后每个新任务自动挂载。
      // 设置页配置经 host 注入（imageGen），未注入时回退读 <dataDir>/private/image-gen.json。
      const image = await createImageTool({ cwd, dataDir, getMode: permissions ? () => permissions.getMode() : undefined,
        ...(imageGen !== undefined ? { config: imageGen } : {}) });
      // M06 桌面工具：helper 未随包提供（desktop.helperPath 缺失/文件不存在）时返回 []，模型看不到；
      // 全部动作经全局桌面独占队列跨项目串行（P06.1/P06.3）。
      await desktopTools?.dispose?.();
      desktopTools = desktop?.helperPath
        ? createDesktopTools({ helperPath: desktop.helperPath, dataDir, ownerId: `conversation:${conversation?.id ?? task?.id ?? 'anon'}`,
          getMode: permissions ? () => permissions.getMode() : undefined, emit, taskSignal: controller.signal })
        : [];
      const extraTools = [image, ...desktopTools].filter(Boolean);
      const customTools = extraTools.length ? [...(base ?? []), ...extraTools] : base;
      const toolNames = extraTools.length
        ? [...(base ? base.map(tool => tool.name) : defaultToolNames), ...extraTools.map(tool => tool.name)]
        : base ? base.map(tool => tool.name) : defaultToolNames;
      ({ session } = await createAgentSession({
        cwd, agentDir, modelRuntime, model: active.model, thinkingLevel: active.thinkingLevel,
        resourceLoader: resourceLoader(instructions), sessionManager,
        settingsManager: sdkSettings(duration),
        tools: toolNames,
        customTools: customTools?.length ? customTools : undefined,
      }));
      const transform = session.agent.transformContext?.bind(session.agent);
      session.agent.transformContext = async (messages, requestSignal) => {
        const context = transform ? await transform(messages, requestSignal) : messages;
        const current = images?.length ? context.findLastIndex(item => item.role === 'user') : -1;
        return context.map((item, index) => {
          if (index === current || item.role !== 'user' || !Array.isArray(item.content) ||
              !item.content.some(part => part.type === 'image')) return item;
          return { ...item, content: [...item.content.filter(part => part.type !== 'image'),
            { type: 'text', text: '［先前附带的图片，请重新附加后查看］' }] };
        });
      };
      if (repair && active === primary) {
        const prepare = session.agent.prepareRequest;
        session.agent.prepareRequest = async (request, requestSignal) => {
          const update = await prepare?.(request, requestSignal);
          if (!repair.ready() || active !== primary || requestSignal?.aborted) return update;
          await session.setModel(backup.model);
          session.setThinkingLevel(backup.thinkingLevel);
          switched('repair');
          return { ...update, model: backup.model, thinkingLevel: session.thinkingLevel };
        };
      }
      unsubscribe = session.subscribe(event => {
        if (active === primary) repair?.event(event);
        if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
          const delta = event.assistantMessageEvent.delta; text += delta; progressed ||= Boolean(delta);
          emit('text_delta', { delta });
        } else if (event.type === 'message_end' && event.message?.role === 'assistant') {
          last = event.message;
          const used = routes.get(last.provider) ?? active;
          lastFailure = used.proxy.failure();
          const rawUsage = used.proxy.takeUsage();
          if (last.usage && rawUsage) {
            try {
              emit('usage', { ...normalizeUsage(last.usage, rawUsage), providerId: used.profile.id,
                model: used.profile.model, contextWindow: used.profile.contextWindow });
            } catch { /* Missing or malformed provider usage is never estimated. */ }
          }
        } else if (event.type === 'compaction_end') {
          const raw = active.proxy.takeUsage();
          const extra = active.proxy.takeUsage();
          if (extra) while (active.proxy.takeUsage()) { /* Clear summary usage before the next reply. */ }
          if (event.result?.usage && raw && !extra) {
            try {
              emit('usage', { ...normalizeUsage(event.result.usage, raw), providerId: active.profile.id,
                model: active.profile.model, contextWindow: active.profile.contextWindow, kind: 'compaction' });
            } catch { /* Incomplete compaction usage is not estimated. */ }
          }
        } else if (event.type === 'tool_execution_start') {
          progressed = true;
          emit('tool_start', { toolCallId: event.toolCallId, toolName: event.toolName, args: event.args });
        } else if (event.type === 'tool_execution_update') {
          emit('tool_update', { toolCallId: event.toolCallId, partialResult: event.partialResult });
        } else if (event.type === 'tool_execution_end') {
          emit('tool_end', { toolCallId: event.toolCallId, toolName: event.toolName, result: event.result, isError: event.isError });
        }
      });
    }
    const onAbort = () => { session?.clearQueue(); void session?.abort(); };
    controller.signal.addEventListener('abort', onAbort, { once: true });
    try {
      const checkpoint = sessionManager.getLeafId();
      for (;;) {
        await createSession();
        if (controller.signal.aborted) throw aborted();
        last = undefined; lastFailure = undefined;
        // P03.13.18 上下文满载自救：阈值压缩依赖的投影估算可能滞后于真实用量（长会话缓存命中场景），
        // 提交前用上一轮真实 usage 预检；超过窗口-40k 时先手动压缩，让总结请求保有足够余量。
        // P03.13.20 修正：压缩请求自身的失败不再一律当上下文超限——生产徐-moss-hotal 会话在
        // 90,276/128,000（余量 38k）时压缩请求失败，任务被误报「上下文过长」；真实原因（限流/超时/
        // 网络）被硬编码包装吞掉。现在按 classifyTaskError 分类：只有分类仍为 context_limit（真超限，
        // 总结请求也超限的死锁）才终止；其余失败记录原因后继续提交——窗口尚有 40k 预留余量，
        // 由 PI 溢出恢复（compact-and-retry）兑底。
        // 「无可压缩历史/已压缩过」不是失败，直接继续任务由 PI 溢出恢复兑底。
        const previousUsage = session.messages.findLast(item => item.role === 'assistant')?.usage;
        const contextWindow = active.model?.contextWindow ?? 0;
        if (contextWindow > PRE_COMPACT_MARGIN_TOKENS
          && contextTokensUsed(previousUsage) > contextWindow - PRE_COMPACT_MARGIN_TOKENS) {
          try {
            await session.compact();
          } catch (error) {
            const reason = String(error?.message ?? '');
            if (!reason.includes('Nothing to compact') && !reason.includes('Already compacted')) {
              if (classifyTaskError(error).code === 'context_limit') throw new TaskFailure('context_limit');
              console.error('[moos-pi] pre-compaction failed, continuing with existing context:',
                classifyTaskError(error).code, reason.slice(0, 300));
            }
          }
        }
        let prompt = message;
        if (retry) {
          const previous = session.messages.findLast(item => item.role === 'user')?.content;
          const priorText = typeof previous === 'string' ? previous
            : previous?.filter(part => part.type === 'text').map(part => part.text).join('\n');
          const recoveryWithOriginal = `${retryPrompt}\n\n原始任务：\n${message}`;
          prompt = [message, retryPrompt, recoveryWithOriginal].includes(priorText) ? retryPrompt : recoveryWithOriginal;
        }
        await session.prompt(prompt, images?.length ? { images } : undefined);
        await session.waitForIdle();
        if (controller.signal.aborted || last?.stopReason === 'aborted') throw aborted();
        if (last?.stopReason === 'stop') {
          if (captureCheckpoint) {
            const leaf = sessionManager.getBranch().findLast(entry => entry.type === 'message')?.id;
            const file = sessionManager.getSessionFile();
            if (leaf && file) emit('pi_checkpoint', { leaf, file: basename(file) });
          }
          return { text };
        }
        const code = lastFailure ?? active.proxy.failure() ??
          classifyTaskError(new Error(last?.errorMessage ?? `PI model stop reason ${last?.stopReason ?? 'missing'}`)).code;
        if (!backup || active !== primary || progressed || !['rate_limit', 'quota', 'network'].includes(code)) {
          throw new TaskFailure(code);
        }
        unsubscribe?.(); session.dispose(); session = undefined; unsubscribe = undefined;
        if (checkpoint === null) sessionManager.resetLeaf();
        else sessionManager.branch(checkpoint);
        switched(code);
      }
    } finally { controller.signal.removeEventListener('abort', onAbort); }
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
    try { unsubscribe?.(); session?.dispose(); }
    finally {
      try { await desktopTools?.dispose?.(); }
      finally {
        try { await Promise.all([...routes.values()].map(entry => entry.proxy.close())); }
        finally { busy.delete(root); busy.delete(cwd); }
      }
    }
  }
}
