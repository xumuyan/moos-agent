import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { Store } from './store.mjs';
import { Scheduler } from './scheduler.mjs';
import { diagnoseProvider } from './provider-diagnostics.mjs';
import { ALLOWED_TASK_TIMEOUTS, DEFAULT_TASK_TIMEOUT_MS, taskTimeout } from './task-policy.mjs';
import { configuredCost } from './usage.mjs';

function validatePricing(input) {
  if (input === undefined || input === null) return undefined;
  if (!input || typeof input !== 'object' || typeof input.version !== 'string' || !input.version.trim() || input.version.length > 100) throw new Error('模型价格版本无效');
  const result = { version: input.version.trim() };
  for (const key of ['inputPerMillion', 'outputPerMillion', 'cacheReadPerMillion', 'cacheWritePerMillion']) {
    const value = input[key];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000000) throw new Error('模型价格无效');
    result[key] = value;
  }
  if (result.inputPerMillion === undefined || result.outputPerMillion === undefined) throw new Error('模型输入和输出价格必须同时填写');
  return result;
}

function validateProvider(input) {
  if (!input || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.id ?? '')) throw new Error('模型配置标识无效');
  if (typeof input.baseUrl !== 'string' || input.baseUrl.length > 2048) throw new Error('模型地址 metadata budget 无效');
  const url = new URL(input.baseUrl);
  if (url.username || url.password || url.search || url.hash ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) {
    throw new Error('模型地址必须为 HTTPS，本机测试可使用回环 HTTP');
  }
  if (!['openai-completions', 'openai-responses'].includes(input.api) ||
      typeof input.model !== 'string' || !input.model.trim() || input.model.length > 200) throw new Error('模型或协议无效');
  const pricing = validatePricing(input.pricing);
  return { id: input.id, name: String(input.name || input.model).slice(0, 100),
    baseUrl: url.href.replace(/\/$/, ''), model: input.model.trim(), api: input.api,
    contextWindow: 128000, maxTokens: 8192, ...(pricing ? { pricing } : {}) };
}

function usageSince(range) {
  const date = new Date();
  if (range === 'all') return undefined;
  if (range === 'today') { date.setHours(0, 0, 0, 0); return date.toISOString(); }
  if (range === '7d') return new Date(Date.now() - 7 * 86400000).toISOString();
  if (range === '30d') return new Date(Date.now() - 30 * 86400000).toISOString();
  throw new Error('Invalid usage range');
}

export async function createController({ dataDir, run, shutdownTimeoutMs = 15000 }) {
  if (!Number.isFinite(shutdownTimeoutMs) || shutdownTimeoutMs < 0) throw new Error('Invalid shutdown timeout');
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const store = new Store({ dbPath: join(dataDir, 'moos.sqlite') });
  store.interruptUnfinished();
  let taskTimeoutMs;
  try { taskTimeoutMs = taskTimeout(Number(store.getSetting('taskTimeoutMs') ?? DEFAULT_TASK_TIMEOUT_MS)); }
  catch { taskTimeoutMs = DEFAULT_TASK_TIMEOUT_MS; store.setSetting('taskTimeoutMs', String(taskTimeoutMs)); }
  const providerFile = join(dataDir, 'providers.json');
  let providers = [];
  try { providers = JSON.parse(await readFile(providerFile, 'utf8')).map(validateProvider); }
  catch (error) { if (error.code !== 'ENOENT') { store.close(); throw error; } }
  const configs = new Map();
  const scheduler = new Scheduler({ store, concurrency: 2,
    run: async options => {
      const config = configs.get(options.task.id);
      if (!config) throw new Error('任务模型配置已失效');
      const redact = value => typeof value === 'string' ? value.split(config.apiKey).join('[REDACTED]')
        : Array.isArray(value) ? value.map(redact)
        : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item)])) : value;
      const secret = config.apiKey;
      const prefixLength = text => {
        for (let length = Math.min(secret.length - 1, text.length); length > 0; length--) {
          if (text.endsWith(secret.slice(0, length))) return length;
        }
        return 0;
      };
      let trailing = '';
      let lastTextPayload;
      const toolTails = new Map();
      // Tool updates may be deltas OR cumulative snapshots. Mask ambiguous
      // prefixes in place rather than delaying whole events or their metadata.
      // This protects exact-key string streams, not arbitrary encoded exfiltration.
      const redactTool = (value, path) => {
        if (typeof value === 'string') {
          const previous = toolTails.get(path) ?? '';
          const combined = previous + value;
          const masked = new Uint8Array(value.length);
          let index = combined.indexOf(secret);
          while (index !== -1) {
            masked.fill(1, Math.max(0, index - previous.length), Math.max(0, index + secret.length - previous.length));
            index = combined.indexOf(secret, index + 1);
          }
          const length = prefixLength(combined);
          masked.fill(1, Math.max(0, value.length - length));
          toolTails.set(path, combined.slice(combined.length - length));
          let result = '';
          for (let i = 0; i < value.length; i++) {
            if (!masked[i]) result += value[i];
            else if (i === 0 || !masked[i - 1]) result += '[REDACTED]';
          }
          return result;
        }
        if (Array.isArray(value)) return value.map((item, index) => redactTool(item, `${path}/${index}`));
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) =>
          // Discriminants describe the schema, not streamed output.
          [key, key === 'type' ? redact(item) : redactTool(item, `${path}/${JSON.stringify(key)}`)]));
        return value;
      };
      try {
        const result = await run({ ...options, ...config, dataDir,
          task: { ...options.task, text: options.task.message },
          emit: (type, payload) => {
            if (type === 'usage') {
              try {
                const configured = configuredCost(payload, config.provider.pricing);
                const costUsd = payload.providerCostUsd ?? configured;
                const costSource = typeof payload.providerCostUsd === 'number' ? 'provider' : configured !== null ? 'configured' : null;
                store.recordUsage({ ...payload, taskId: options.task.id, projectId: options.task.projectId,
                  conversationId: options.task.conversationId, providerId: config.provider.id, model: config.provider.model,
                  contextWindow: config.provider.contextWindow, costUsd, costSource,
                  priceVersion: costSource === 'configured' ? config.provider.pricing.version : null });
                return options.emit(type, { ...payload, costUsd, costSource });
              } catch { return undefined; }
            }
            if (type === 'text_delta' && typeof payload?.delta === 'string') {
              const text = trailing + payload.delta;
              // Replace complete keys first; retain only a possible raw key prefix.
              const parts = text.split(secret);
              const last = parts.pop();
              const length = prefixLength(last);
              trailing = last.slice(last.length - length);
              lastTextPayload = redact(payload);
              return options.emit(type, { ...lastTextPayload,
                delta: parts.map(part => part + '[REDACTED]').join('') + last.slice(0, last.length - length) });
            }
            if (type === 'tool_update' && payload?.partialResult !== undefined) {
              return options.emit(type, { ...redact(payload), partialResult: redactTool(payload.partialResult, JSON.stringify(payload.toolCallId)) });
            }
            return options.emit(type, redact(payload));
          } });
        return redact(result);
      } finally {
        try {
          if (trailing) options.emit('text_delta', { ...lastTextPayload, delta: trailing });
        } finally { configs.delete(options.task.id); }
      }
    },
  });
  let providerWrites = Promise.resolve();
  function persistProviders(update) {
    const write = providerWrites.then(async () => {
      const next = update(providers);
      if (next.length > 32 || Buffer.byteLength(JSON.stringify(next)) > 96 * 1024) throw new Error('Provider metadata budget limit reached');
      await writeFile(`${providerFile}.tmp`, JSON.stringify(next), { mode: 0o600 });
      await rename(`${providerFile}.tmp`, providerFile);
      providers = next;
    });
    providerWrites = write.catch(() => {});
    return write;
  }
  let closed = false;
  let closing = false;
  let closePromise;
  async function request(method, params = {}) {
    if (closed || closing) throw new Error('任务服务已关闭');
    switch (method) {
      case 'snapshot': {
        if (params.taskTimeline) return { taskTimeline: store.taskTimeline(params) };
        const projects = store.listProjects();
        const conversations = projects.flatMap(project => store.listConversations(project.id));
        const snapshot = { projects, conversations, ...store.snapshotHistory(params), providers,
          usageContexts: store.latestUsageContexts(),
          runtime: { taskTimeoutMs, allowedTaskTimeouts: ALLOWED_TASK_TIMEOUTS } };
        // Include JSON escaping and UTF-8 bytes, not JS string length. Leave ample
        // headroom for the RPC envelope below the native 4 MiB line limit.
        if (Buffer.byteLength(JSON.stringify(snapshot)) > 1024 * 1024 - 4096) {
          throw new Error('Snapshot metadata exceeds transport budget; reduce projects/conversations or provider metadata');
        }
        return snapshot;
      }
      case 'list_models':
      case 'test_provider': return diagnoseProvider(method, params);
      case 'add_project': return store.addProject(params.path);
      case 'remove_project':
        store.removeProject(params.projectId);
        return { removed: true };
      case 'create_conversation': return store.createConversation(params.projectId, params.title);
      case 'rename_conversation': return store.renameConversation(params);
      case 'save_provider': {
        const provider = validateProvider(params.provider);
        await persistProviders(current => [...current.filter(item => item.id !== provider.id), provider]);
        return provider;
      }
      case 'remove_provider': {
        const providerId = params.providerId;
        await persistProviders(current => current.filter(item => item.id !== providerId));
        return { removed: true };
      }
      case 'set_task_policy': {
        taskTimeoutMs = taskTimeout(params.taskTimeoutMs);
        store.setSetting('taskTimeoutMs', String(taskTimeoutMs));
        return { taskTimeoutMs, allowedTaskTimeouts: ALLOWED_TASK_TIMEOUTS };
      }
      case 'get_usage': {
        const { range = 'today', providerId, model, projectId, conversationId } = params;
        return { range, ...store.usageSummary({ since: usageSince(range), providerId, model, projectId, conversationId }) };
      }
      case 'export_usage': return store.exportUsage({ limit: params.limit });
      case 'clear_usage': return { removed: store.clearUsage() };
      case 'submit': {
        const provider = providers.find(item => item.id === params.providerId);
        if (!provider) throw new Error('请先配置模型');
        if (typeof params.message !== 'string' || !params.message.trim() || params.message.length > 100000) throw new Error('任务内容无效');
        if (typeof params.apiKey !== 'string' || !params.apiKey) throw new Error('请先在本机设置模型密钥');
        if (store.countActiveTasks() >= 128) throw new Error('Active task limit reached (128)');
        const task = scheduler.submit({ conversationId: params.conversationId, message: params.message.trim(), timeoutMs: taskTimeoutMs });
        configs.set(task.id, { provider: { ...provider }, apiKey: params.apiKey });
        return task;
      }
      case 'cancel': {
        const result = await scheduler.cancel(params.taskId);
        if (store.getTask(params.taskId)?.status === 'cancelled') configs.delete(params.taskId);
        return result;
      }
      default: throw new Error('不支持的服务请求');
    }
  }
  return { request, close() {
    if (closePromise) return closePromise;
    if (closed) return Promise.resolve();
    closing = true;
    closePromise = (async () => {
      const { drained } = await scheduler.shutdown({ timeoutMs: shutdownTimeoutMs });
      if (!drained) throw new Error('任务进程尚未停止');
      await providerWrites;
      configs.clear();
      store.close();
      closed = true;
    })().finally(() => { closePromise = undefined; });
    return closePromise;
  } };
}
