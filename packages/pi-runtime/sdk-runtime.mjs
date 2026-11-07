import { lstat, readFile, realpath } from 'node:fs/promises';
import { resolve, join, isAbsolute } from 'node:path';
import {
  createAgentSession, createExtensionRuntime, ModelRuntime,
  SessionManager, SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { Agent as UndiciAgent, setGlobalDispatcher } from 'undici';
import { checkedProvider, context, privateDir, privateFile, proxyFor } from '../pi-adapter/index.mjs';
import { classifyTaskError, TaskFailure } from '../../services/agent/errors.mjs';
import { ALLOWED_TASK_TIMEOUTS, taskTimeout } from '../../services/agent/task-policy.mjs';
import { normalizeUsage } from '../../services/agent/usage.mjs';
import { workspaceTools } from './tool-policy.mjs';
import { repairRouting } from './repair-routing.mjs';

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
  return SettingsManager.inMemory({ httpIdleTimeoutMs: taskTimeout(duration),
    compaction: { enabled: false }, retry: { enabled: false, provider: { timeoutMs: taskTimeout(duration) } } });
}

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
export async function runPiSdk({ task, project, conversation, signal, emit = () => {}, provider, dataDir, apiKey, permissions, routing, retry }) {
  const upstream = checkedProvider(provider);
  const { message, duration } = validate({ task, project, conversation, dataDir, apiKey });
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
  let session; let unsubscribe;
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
        models: [{ id: profile.model, name: profile.name, reasoning: thinkingLevel !== 'off' || profile.service === 'glm', input: ['text'],
          ...(thinkingLevel === 'xhigh' ? { thinkingLevelMap: { xhigh: 'xhigh' } } : {}),
          contextWindow: profile.contextWindow, maxTokens: profile.maxTokens,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
      };
    }
    await add(provider, upstream, apiKey);
    if (routing?.backup && routing.backup.provider.id !== provider.id) {
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
    const sessionManager = SessionManager.continueRecent(cwd, root);
    const primary = routes.get(provider.id);
    const backup = routes.get(routing?.backup?.provider.id);
    const repair = backup && routing.backup.repair ? repairRouting() : undefined;
    let active = primary;
    let text = ''; let last; let progressed = false;
    const switched = (reason) => {
      active = backup;
      emit('model_route', { from: primary.profile.name, to: backup.profile.name, reason });
    };
    async function createSession() {
      const customTools = permissions && workspaceTools(cwd, permissions);
      ({ session } = await createAgentSession({
        cwd, agentDir, modelRuntime, model: active.model, thinkingLevel: active.thinkingLevel,
        resourceLoader: resourceLoader(instructions), sessionManager,
        settingsManager: sdkSettings(duration),
        tools: customTools?.map(tool => tool.name) ?? ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls'],
        customTools,
      }));
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
          const rawUsage = used.proxy.takeUsage();
          if (last.usage && rawUsage) {
            try {
              emit('usage', { ...normalizeUsage(last.usage, rawUsage), providerId: used.profile.id,
                model: used.profile.model, contextWindow: used.profile.contextWindow });
            } catch { /* Missing or malformed provider usage is never estimated. */ }
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
        last = undefined;
        let prompt = message;
        if (retry) {
          const previous = session.messages.findLast(item => item.role === 'user')?.content;
          const priorText = typeof previous === 'string' ? previous
            : previous?.filter(part => part.type === 'text').map(part => part.text).join('\n');
          const recoveryWithOriginal = `${retryPrompt}\n\n原始任务：\n${message}`;
          prompt = [message, retryPrompt, recoveryWithOriginal].includes(priorText) ? retryPrompt : recoveryWithOriginal;
        }
        await session.prompt(prompt);
        await session.waitForIdle();
        if (controller.signal.aborted || last?.stopReason === 'aborted') throw aborted();
        if (last?.stopReason === 'stop') return { text };
        const code = active.proxy.failure() ??
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
    unsubscribe?.(); session?.dispose();
    await Promise.all([...routes.values()].map(entry => entry.proxy.close()));
    busy.delete(root); busy.delete(cwd);
  }
}
