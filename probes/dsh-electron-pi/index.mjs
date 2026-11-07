import { realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const name = 'moos-pi-probe';
export const inject = ['llm', 'agents'];
export const route = 'moos-pi-probe';
export const model = 'pi-fixture';
const tools = new Set(['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls']);
const marker = /^MOOS_FIXTURE_(?:WRITE [a-zA-Z0-9_]{1,32}|TOOLS|HOLD)$/;

function textMessage(request) {
  const user = request.messages.findLast(message => message.role === 'user' && message.source?.kind === 'user');
  if (!user?.content?.every(part => part.type === 'text')) return '';
  return user.content.map(part => part.text).join('\n').trim();
}

function failure(kind, code, message) {
  return { type: 'finish', reason: { kind, failure: { code, message } } };
}

function* textBlock(index, text) {
  yield { type: 'block-start', index, blockType: 'text' };
  yield { type: 'text-delta', index, text };
  yield { type: 'block-end', index, block: { type: 'text', text } };
}

export function createAdapter({ workspace, dataDir, run, getSession, fixture }) {
  const metadata = { provider: route, id: model, name: 'Moos PI · 本地验收',
    contextWindow: 128000, inputModalities: ['text'] };
  const provider = { id: route, name: 'Moos PI', model: 'moos-fixture', api: 'openai-completions',
    baseUrl: fixture.baseUrl, contextWindow: 128000, maxTokens: 8192 };

  async function* stream(request) {
    const input = textMessage(request);
    if (request.signal?.aborted) {
      yield failure('aborted', 'CANCELLED', 'PI 任务已停止');
      return;
    }
    if (request.purpose === 'session-title') {
      yield* textBlock(0, 'Moos PI 验收');
      yield { type: 'finish', reason: { kind: 'stop' } };
      return;
    }
    const sessionId = request.sessionId;
    const cwd = typeof sessionId === 'string' ? getSession(sessionId)?.header?.cwd : undefined;
    if (request.purpose || typeof sessionId !== 'string'
      || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(sessionId)) {
      yield failure('error', 'INVALID_REQUEST', 'PI 验收需要当前桌面会话');
      return;
    }
    if (!cwd || await realpath(cwd).catch(() => null) !== workspace) {
      yield failure('error', 'INVALID_REQUEST', 'PI 验收只接受指定临时工作区');
      return;
    }
    if (!marker.test(input)) {
      yield failure('error', 'INVALID_REQUEST', 'PI 验收只接受本地测试指令');
      return;
    }

    const local = new AbortController();
    const signal = request.signal ? AbortSignal.any([local.signal, request.signal]) : local.signal;
    const pending = [];
    let wake = () => {};
    let done = false;
    let failed = false;
    let streamed = false;
    const push = event => { pending.push(event); wake(); };
    const execution = Promise.resolve().then(() => run({
      task: input, conversation: { id: sessionId }, project: { path: workspace }, dataDir,
      provider, apiKey: fixture.apiKey, signal,
      emit(type, payload) {
        if (type === 'tool_end' && tools.has(payload.toolName)) {
          push({ text: `PI 工具 ${payload.toolName}：${payload.isError ? '失败' : '完成'}\n` });
        } else if (type === 'text_delta' && typeof payload.delta === 'string') {
          streamed = true;
          push({ delta: payload.delta });
        }
      },
    })).then(result => {
      if (!streamed && result.text) push({ delta: result.text });
    }).catch(() => { failed = true; }).finally(() => { done = true; wake(); });

    let index = 0;
    let answer = '';
    let answerOpen = false;
    try {
      while (!done || pending.length) {
        if (!pending.length) {
          await new Promise(resolve => { wake = resolve; });
          continue;
        }
        const event = pending.shift();
        if (event.text) {
          if (answerOpen) {
            yield { type: 'block-end', index: index++, block: { type: 'text', text: answer } };
            answer = '';
            answerOpen = false;
          }
          yield* textBlock(index++, event.text);
        } else {
          if (!answerOpen) {
            yield { type: 'block-start', index, blockType: 'text' };
            answerOpen = true;
          }
          answer += event.delta;
          yield { type: 'text-delta', index, text: event.delta };
        }
      }
      if (answerOpen) yield { type: 'block-end', index, block: { type: 'text', text: answer } };
      if (signal.aborted) yield failure('aborted', 'CANCELLED', 'PI 任务已停止');
      else if (failed) yield failure('error', 'INVALID_REQUEST', 'PI 验收任务失败');
      else yield { type: 'finish', reason: { kind: 'stop' } };
    } finally {
      local.abort();
      await execution;
    }
  }

  return {
    providerInfo: id => ({ id, name: 'Moos PI' }),
    providerRetryPolicy: () => undefined,
    imageRequestPricing: () => undefined,
    imageRequestTarget: (_provider, _model, image) => ({ width: image.width, height: image.height, bytes: image.bytes }),
    listModels: async () => [metadata],
    resolveModel: async () => metadata,
    prepareCall: async () => ({ model: metadata, stream }),
    stream,
  };
}

export async function apply(ctx) {
  const workspacePath = process.env.MOOS_DSH_PI_WORKSPACE;
  const dataDir = process.env.MOOS_DSH_PI_DATA;
  const resources = process.env.MOOS_DSH_PI_RESOURCES;
  if (![workspacePath, dataDir, resources].every(path => typeof path === 'string' && isAbsolute(path))) return;

  const workspace = await realpath(workspacePath);
  const load = path => import(pathToFileURL(join(resources, path)).href);
  const [{ runPiSdk }, { startFixture }] = await Promise.all([
    load('packages/pi-runtime/sdk-runtime.mjs'), load('services/agent/fixture.mjs'),
  ]);
  const fixture = await startFixture();
  try {
    ctx.llm.registerAdapter([route], createAdapter({
      workspace, dataDir, run: runPiSdk, fixture, getSession: id => ctx.agents.get(id)?.session,
    }));
    ctx.on('dispose', () => fixture.close());
  } catch (error) {
    await fixture.close();
    throw error;
  }
}
