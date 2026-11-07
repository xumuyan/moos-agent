export const route = 'moos-pi';
export const model = 'pi-fixture';

const metadata = { provider: route, id: model, name: 'Moos PI · 本地调度验收',
  contextWindow: 128000, inputModalities: ['text'] };
const tools = new Set(['read', 'write', 'edit', 'bash', 'bash_escalated', 'grep', 'find', 'ls']);
const errors = {
  auth: { code: 'AUTHENTICATION', message: '本地模型验收返回认证失败' },
  rate_limit: { code: 'RATE_LIMIT', message: '本地模型验收返回限流' },
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

export function createFixtureAdapter({ tasks, getSession, getPermissions }) {
  async function* stream(request) {
    const lifetime = new AbortController();
    const signal = request.signal ? AbortSignal.any([lifetime.signal, request.signal]) : lifetime.signal;
    if (signal.aborted) { yield aborted; return; }
    if (request.purpose === 'session-title') {
      yield* textBlock(0, 'Moos PI 调度验收');
      yield stop;
      return;
    }
    const sessionId = request.sessionId;
    const user = request.messages?.findLast(message => message.role === 'user' && message.source?.kind === 'user');
    if (request.purpose || !user?.content?.every(part => part.type === 'text') || typeof sessionId !== 'string') {
      yield rejected;
      return;
    }

    let task;
    try {
      task = await tasks.open({ sessionId, cwd: getSession(sessionId)?.header?.cwd,
        input: user.content.map(part => part.text).join('\n').trim(),
        signal, permissions: getPermissions?.(sessionId) });
    } catch {
      yield signal.aborted ? aborted : rejected;
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
          if (type === 'tool_end' && tools.has(payload.toolName)) {
            yield* textBlock(index++, `PI 工具 ${payload.toolName}：${payload.isError ? '失败' : '完成'}\n`);
          } else if (type === 'task_state' && payload.status === 'succeeded') {
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
    listModels: async () => [metadata],
    resolveModel: async () => metadata,
    prepareCall: async () => ({ model: metadata, stream }),
    stream,
  };
}
