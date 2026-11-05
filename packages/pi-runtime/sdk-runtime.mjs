import { lstat, readFile, realpath } from 'node:fs/promises';
import { resolve, join, isAbsolute } from 'node:path';
import {
  createAgentSession, createExtensionRuntime, ModelRuntime,
  SessionManager, SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { checkedProvider, context, privateDir, privateFile, proxyFor } from '../pi-adapter/index.mjs';

const busy = new Set();

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

function validate({ task, project, conversation, dataDir, apiKey }) {
  if (!conversation || typeof conversation.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(conversation.id)) throw new Error('Invalid conversation id');
  const message = typeof task === 'string' ? task : task?.text;
  const duration = typeof task === 'object' && task.timeoutMs !== undefined ? task.timeoutMs : 600000;
  if (typeof message !== 'string' || !message.trim() || Buffer.byteLength(message) > 1024 * 1024 || !Number.isInteger(duration) || duration < 1 || duration > 600000) throw new Error('Invalid task or timeout');
  if (typeof apiKey !== 'string' || !apiKey || apiKey.length > 16384 || /[\r\n\x00]/.test(apiKey)) throw new Error('Invalid API key');
  if (!project || !isAbsolute(project.path) || !isAbsolute(dataDir)) throw new Error('Absolute project and dataDir required');
  return { message, duration };
}

/** Run a PI task in the existing Node host through the official SDK; no per-task Node process. */
export async function runPiSdk({ task, project, conversation, signal, emit = () => {}, provider, dataDir, apiKey }) {
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
  const timer = setTimeout(abort, duration);
  let proxy; let session; let unsubscribe;
  try {
    if (controller.signal.aborted) throw new Error('PI task aborted');
    await privateDir(dataDir); await privateDir(root);
    const agentDir = join(root, 'agent');
    await privateDir(agentDir);
    const instructions = await context(cwd);
    proxy = await proxyFor(provider, upstream, apiKey);
    const modelsPath = join(agentDir, 'models.json');
    await privateFile(modelsPath, JSON.stringify({ providers: { [provider.id]: {
      baseUrl: proxy.baseUrl, api: provider.api, authHeader: true,
      models: [{ id: provider.model, name: provider.name, reasoning: false, input: ['text'], contextWindow: provider.contextWindow, maxTokens: provider.maxTokens, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    } } }));
    const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath, refreshOnCreate: false });
    await modelRuntime.setRuntimeApiKey(provider.id, proxy.token);
    const model = modelRuntime.getModel(provider.id, provider.model);
    if (!model) throw new Error('PI SDK model unavailable');
    const sessionManager = SessionManager.continueRecent(cwd, root);
    ({ session } = await createAgentSession({
      cwd, agentDir, modelRuntime, model, thinkingLevel: 'off',
      resourceLoader: resourceLoader(instructions), sessionManager,
      settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
      tools: ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls'],
    }));
    let text = ''; let last;
    unsubscribe = session.subscribe(event => {
      if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
        const delta = event.assistantMessageEvent.delta; text += delta; emit('text_delta', { delta });
      } else if (event.type === 'message_end' && event.message?.role === 'assistant') {
        last = event.message; if (last.usage) emit('usage', last.usage);
      } else if (event.type === 'tool_execution_start') {
        emit('tool_start', { toolCallId: event.toolCallId, toolName: event.toolName, args: event.args });
      } else if (event.type === 'tool_execution_update') {
        emit('tool_update', { toolCallId: event.toolCallId, partialResult: event.partialResult });
      } else if (event.type === 'tool_execution_end') {
        emit('tool_end', { toolCallId: event.toolCallId, toolName: event.toolName, result: event.result, isError: event.isError });
      }
    });
    const onAbort = () => { session.clearQueue(); void session.abort(); };
    controller.signal.addEventListener('abort', onAbort, { once: true });
    try {
      if (controller.signal.aborted) throw new Error('PI task aborted');
      await session.prompt(message);
      await session.waitForIdle();
      if (controller.signal.aborted || last?.stopReason === 'aborted') throw new Error('PI task aborted');
      if (!last || last.stopReason !== 'stop') throw new Error(`PI model failed to finish successfully (${last?.stopReason ?? 'missing'})`);
      return { text };
    } finally { controller.signal.removeEventListener('abort', onAbort); }
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
    unsubscribe?.(); session?.dispose();
    if (proxy) await proxy.close();
    busy.delete(root); busy.delete(cwd);
  }
}
