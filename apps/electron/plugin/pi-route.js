import { forkPrefix } from './pi-fork.js';

export const route = 'moos-pi';
export const model = 'pi-fixture';

const metadata = { provider: route, id: model, name: 'Moos PI · 本地调度验收',
  contextWindow: 128000, inputModalities: ['text'] };
const errors = {
  auth: { code: 'AUTHENTICATION', message: '模型服务认证失败' },
  rate_limit: { code: 'RATE_LIMIT', message: '模型服务请求限流' },
  quota: { code: 'QUOTA', message: '模型服务额度不足' },
  network: { code: 'NETWORK', message: '无法连接模型服务' },
  timeout: { code: 'TIMEOUT', message: 'PI 任务超时' },
};
const stop = { type: 'finish', reason: { kind: 'stop' } };
const aborted = { type: 'finish', reason: { kind: 'aborted', failure: { code: 'CANCELLED', message: 'PI 任务已停止' } } };
const rejected = { type: 'finish', reason: { kind: 'error',
  failure: { code: 'INVALID_REQUEST', message: 'PI 本地验收只接受临时项目和固定测试指令' } } };

function* textBlock(index, text) {
  yield { type: 'block-start', index, blockType: 'text' };
  yield { type: 'text-delta', index, text };
  yield { type: 'block-end', index, block: { type: 'text', text } };
}

function sessionTitle(request) {
  const text = request.messages?.findLast(item => item.role === 'user')?.content
    ?.find(part => part.type === 'text')?.text;
  const prefix = 'Generate the session title from this JSON array of human messages:\n';
  let content = text;
  if (text?.startsWith(prefix)) {
    try { content = JSON.parse(text.slice(prefix.length)).find(item => typeof item?.text === 'string')?.text; }
    catch { content = undefined; }
  }
  return content?.trim().split('\n')[0].slice(0, 64) || 'Moos 会话';
}

export function createPiAdapter({ tasks, getSession, getTurnStart, getPermissions, models }) {
  const selectionRequired = { type: 'finish', reason: { kind: 'error',
    failure: { code: 'INVALID_CONFIG', message: '请在 Moos 模型服务中配置可用的模型和 API 密钥' } } };
  const auto = { provider: route, id: 'auto', name: 'Moos PI · 自动选择', inputModalities: ['text'] };
  const modelInfo = profile => ({
    provider: route, id: profile.id, name: profile.name, inputModalities: ['text'],
    description: profile.thinkingLevel === 'off' ? undefined : '推理档位 ' + profile.thinkingLevel,
    context: { contextWindow: profile.contextWindow }, defaultMaxTokens: profile.maxTokens,
  });

  async function resolveModel(_provider, id) {
    if (!models) return metadata;
    if (id === 'auto') {
      const profile = await models.resolve(id);
      return profile ? { ...modelInfo(profile), ...auto } : auto;
    }
    const profile = await models.resolve(id);
    if (!profile) throw new Error('找不到所选的 Moos PI 模型');
    return modelInfo(profile);
  }

  async function* stream(request) {
    const lifetime = new AbortController();
    const signal = request.signal ? AbortSignal.any([lifetime.signal, request.signal]) : lifetime.signal;
    if (signal.aborted) { yield aborted; return; }
    if (request.purpose === 'session-title') {
      yield* textBlock(0, models ? sessionTitle(request) : 'Moos PI 调度验收');
      yield stop;
      return;
    }
    const sessionId = request.sessionId;
    const user = request.messages?.findLast(message => message.role === 'user' && message.source?.kind === 'user');
    if (request.purpose || !user?.content?.every(part => part.type === 'text') || typeof sessionId !== 'string') {
      yield models ? { type: 'finish', reason: { kind: 'error',
        failure: { code: 'INVALID_REQUEST', message: '当前 Moos PI 路由需要工作区内的文本任务' } } } : rejected;
      return;
    }
    const retryOf = /^moos-pi-retry:([a-f0-9-]{36}):[a-f0-9-]{36}$/.exec(user.source.rpcId ?? '')?.[1];

    let plan;
    if (models) {
      try {
        plan = await models.plan(request.model);
        if (!plan.provider) { yield selectionRequired; return; }
        await models.credential(plan.provider);
      } catch { yield selectionRequired; return; }
    }
    let task;
    try {
      const session = getSession(sessionId);
      task = await tasks.open({ sessionId, turnStartSeq: getTurnStart?.(session), cwd: session?.header?.cwd,
        input: user.content.map(part => part.text).join('\n').trim(),
        messageId: user.id, fork: forkPrefix(session), retryOf, signal, permissions: getPermissions?.(sessionId), ...plan });
    } catch {
      yield signal.aborted ? aborted : models ? { type: 'finish', reason: { kind: 'error',
        failure: { code: 'INVALID_REQUEST', message: '无法启动 PI 任务，请检查工作区和会话状态' } } } : rejected;
      return;
    }

    let index = 0;
    let answer = '';
    let finish = aborted;
    try {
      for await (const { type, payload } of task.events()) {
        if (signal.aborted) break;
        if (type === 'text_delta') {
          if (!payload.delta) continue;
          if (!answer) yield { type: 'block-start', index, blockType: 'text' };
          answer += payload.delta;
          yield { type: 'text-delta', index, text: payload.delta };
        } else {
          if (answer) {
            yield { type: 'block-end', index: index++, block: { type: 'text', text: answer } };
            answer = '';
          }
          if (type === 'task_state' && payload.status === 'succeeded') {
            finish = stop;
          } else if (type === 'task_state' && payload.status === 'failed') {
            finish = { type: 'finish', reason: { kind: 'error', failure: errors[payload.errorCode]
              ?? { code: 'INTERNAL', message: 'PI 任务执行失败' } } };
          }
        }
      }
      if (answer) yield { type: 'block-end', index, block: { type: 'text', text: answer } };
      yield signal.aborted ? aborted : finish;
    } finally {
      lifetime.abort();
      await task.stop();
    }
  }
  return {
    providerInfo: () => ({ id: route, name: 'Moos PI' }),
    providerRetryPolicy: () => ({ mode: 'normal', maxRetries: 0, retryableCodes: [],
      initialDelayMs: 100, maxDelayMs: 100, jitterRatio: 0 }),
    imageRequestPricing: () => undefined,
    imageRequestTarget: (_provider, _model, image) => image,
    listModels: async () => models ? [auto, ...(await models.list()).map(modelInfo)] : [metadata],
    resolveModel,
    prepareCall: async (provider, model) => ({ model: await resolveModel(provider, model), stream }),
    stream,
  };
}
