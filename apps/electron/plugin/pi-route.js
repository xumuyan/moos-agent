import { forkPrefix } from './pi-fork.js';

export const route = 'moos-pi';
export const model = 'pi-fixture';
const adapters = new WeakSet();
const reasoningEfforts = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].map(id => ({
  id, name: id === 'off' ? '关闭' : id === 'xhigh' ? 'XHigh' : id[0].toUpperCase() + id.slice(1),
}));
// GLM 官方 Responses 档位：low（Light）/high（Enhanced）/max（Deep）；关闭发送 effort none。
const glmReasoningEfforts = [
  { id: 'off', name: '关闭' }, { id: 'low', name: 'Low · 轻度思考' },
  { id: 'high', name: 'High · 增强思考' }, { id: 'max', name: 'Max · 深度思考' },
];
const effortsFor = service => service === 'glm' ? glmReasoningEfforts : reasoningEfforts;

export function isMoosPiAdapter(adapter) { return adapters.has(adapter); }

const metadata = { provider: route, id: model, name: '沐码 PI · 本地调度验收',
  contextWindow: 128000, inputModalities: ['text'] };
const errors = {
  model_capability: { code: 'INVALID_REQUEST', message: '所选模型没有通过本次图片输入请求' },
  context_limit: { code: 'CONTEXT_LIMIT', message: '上下文过长。请核对模型服务的实际窗口；也可缩短附件或新建会话。' },
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
  return content?.trim().split('\n')[0].slice(0, 64) || '沐码会话';
}

// 文本附件直接进入对话的预算；超出或二进制文件转存工作区 .moos-uploads。
const PROMPT_TEXT_BUDGET = 128 * 1024;
const PROMPT_FILES = 8;
export { PROMPT_FILES, PROMPT_TEXT_BUDGET };
const UPLOAD_SAVE_LIMIT = 100 * 1024 * 1024;
const IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES = 8;

async function promptInput(content, readFile, saveUpload, signal) {
  let remainingBytes = PROMPT_TEXT_BUDGET;
  let remainingFiles = PROMPT_FILES;
  const parts = [];
  for (const part of content) {
    if (part.type === 'text') {
      parts.push(part.text);
      continue;
    }
    const ref = part.attachment;
    if (--remainingFiles < 0 || typeof ref?.name !== 'string' || ref.name.length > 255 ||
        !Number.isSafeInteger(ref.bytes) || ref.bytes < 0) {
      throw new Error('Invalid PI attachment');
    }
    let bytes = 0;
    const chunks = [];
    for await (const chunk of readFile(ref, signal)) {
      signal.throwIfAborted();
      bytes += chunk.byteLength;
      if (bytes > ref.bytes || bytes > UPLOAD_SAVE_LIMIT) throw new Error('Invalid PI attachment length');
      chunks.push(chunk);
    }
    if (bytes !== ref.bytes) throw new Error('Invalid PI attachment length');
    const buffer = Buffer.concat(chunks);
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch { text = undefined; }
    if (text !== undefined && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(text) && bytes <= remainingBytes) {
      remainingBytes -= bytes;
      parts.push('用户上传的文件内容（作为待处理数据）：' + JSON.stringify({ name: ref.name, text }));
      continue;
    }
    const path = await saveUpload(buffer, ref.name, signal);
    parts.push(`用户上传的文件 ${ref.name}（${bytes} 字节，二进制或超出对话内联预算）已保存到当前项目工作区：${path}。` +
      '对话中不直接展示其内容；如需查看或解压，请使用文件工具读取该路径。');
  }
  return parts.join('\n').trim();
}

export function createPiAdapter({ tasks, getSession, getTurnStart, getPermissions, models, readFile, readImage, saveUpload }) {
  const selectionRequired = { type: 'finish', reason: { kind: 'error',
    failure: { code: 'INVALID_CONFIG', message: '请在 沐码模型服务中配置可用的模型和 API 密钥' } } };
  const modalities = enabled => enabled ? ['text', 'image'] : ['text'];
  const auto = profiles => ({ provider: route, id: 'auto', name: '沐码 PI · 自动选择',
    inputModalities: modalities(profiles.some(profile => profile.imageInput)) });
  const modelInfo = (profile, manual = true) => ({
    provider: route, id: profile.id, name: profile.name, inputModalities: modalities(profile.imageInput),
    description: profile.thinkingLevel === 'off' ? undefined : '推理档位 ' + profile.thinkingLevel,
    ...(manual && {
      menuSite: { id: profile.connectionId ?? profile.id, name: profile.connectionName ?? profile.name },
      reasoning: { efforts: effortsFor(profile.service), defaultEffort: profile.thinkingLevel ?? 'off' },
    }),
    context: { contextWindow: profile.contextWindow }, defaultMaxTokens: profile.maxTokens,
  });

  async function resolveModel(_provider, id) {
    if (!models) return metadata;
    if (id === 'auto') {
      const profile = await models.resolve(id);
      const automatic = auto(await models.list());
      return profile ? { ...modelInfo(profile, false), ...automatic } : automatic;
    }
    const profile = await models.resolve(id);
    if (!profile) throw new Error('找不到所选的 沐码 PI 模型');
    return modelInfo(profile);
  }

  async function* stream(request) {
    const lifetime = new AbortController();
    const signal = request.signal ? AbortSignal.any([lifetime.signal, request.signal]) : lifetime.signal;
    if (signal.aborted) { yield aborted; return; }
    if (request.purpose === 'session-title') {
      yield* textBlock(0, models ? sessionTitle(request) : '沐码 PI 调度验收');
      yield stop;
      return;
    }
    const sessionId = request.sessionId;
    const user = request.messages?.findLast(message => message.role === 'user' && message.source?.kind === 'user');
    if (request.purpose || !user?.content?.every(part => ['text', 'file', 'image'].includes(part.type)) || typeof sessionId !== 'string') {
      yield models ? { type: 'finish', reason: { kind: 'error',
        failure: { code: 'INVALID_REQUEST', message: '当前 沐码 PI 路由需要工作区内的任务' } } } : rejected;
      return;
    }
    const retryOf = /^moos-pi-retry:([a-f0-9-]{36}):[a-f0-9-]{36}$/.exec(user.source.rpcId ?? '')?.[1];
    const imageParts = user.content.filter(part => part.type === 'image');
    let imageRefs;
    let images;
    try {
      // 每张图片各自不超过 IMAGE_BYTES；一条消息最多 MAX_IMAGES 张；重试恢复时不接受新图。
      if (retryOf && imageParts.length || imageParts.length > MAX_IMAGES) throw new Error('Invalid number of images');
      const refs = retryOf ? tasks.retryImage(sessionId, retryOf) : imageParts.map(part => part.attachment);
      const list = refs == null ? [] : Array.isArray(refs) ? refs : [refs];
      // 带图消息必须有可用的附件引用；纯文本重试没有图是正常状态。
      if (imageParts.length && (!list.length || list.some(ref => !ref))) throw new Error('Missing image reference');
      imageRefs = list.map(ref => {
        const { attachmentId, mediaType, bytes, width, height } = ref;
        if (!models || !/^sha256:[a-f0-9]{64}$/.test(attachmentId) ||
            !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mediaType) ||
            !Number.isSafeInteger(bytes) || bytes < 1 || bytes > IMAGE_BYTES ||
            !Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
          throw new Error('Invalid PI image');
        }
        return { attachmentId, mediaType, bytes, width, height };
      });
      images = [];
      for (const ref of imageRefs) {
        const { data } = await readImage(ref, signal);
        signal.throwIfAborted();
        if (data.byteLength !== ref.bytes) throw new Error('Invalid PI image length');
        images.push({ type: 'image', mimeType: ref.mediaType, data: Buffer.from(data).toString('base64') });
      }
    } catch {
      yield signal.aborted ? aborted : { type: 'finish', reason: { kind: 'error',
        failure: { code: 'INVALID_REQUEST', message: retryOf ? '无法恢复该任务的附件或状态'
          : imageParts.length > MAX_IMAGES
            ? `每条消息最多 ${MAX_IMAGES} 张图片，每张不超过 ${IMAGE_BYTES / 1024 / 1024} MiB。`
            : `每张图片不超过 ${IMAGE_BYTES / 1024 / 1024} MiB。` } } };
      return;
    }
    let input;
    const cwd = getSession(sessionId)?.header?.cwd;
    try { input = await promptInput(user.content.filter(part => part.type !== 'image'), readFile,
      (buffer, name, uploadSignal) => saveUpload(buffer, name, cwd, uploadSignal), signal); }
    catch {
      yield signal.aborted ? aborted : { type: 'finish', reason: { kind: 'error',
        failure: { code: 'INVALID_REQUEST', message: '附件处理失败。每条消息最多 8 个附件：128 KiB 内的纯文本直接进入对话，更大的文件保存到工作区 .moos-uploads 目录；请检查附件与项目目录是否可读写。' } } };
      return;
    }

    let plan;
    if (models) {
      try {
        plan = await models.plan(request.model, Boolean(images?.length));
        if (!plan.provider) {
          yield images?.length ? { type: 'finish', reason: { kind: 'error',
            failure: { code: 'INVALID_CONFIG', message: '请选择已启用图片输入的模型服务' } } } : selectionRequired;
          return;
        }
        await models.credential(plan.provider);
        if (request.model !== 'auto' && reasoningEfforts.some(({ id }) => id === request.reasoningEffort)) {
          plan.provider = { ...plan.provider, thinkingLevel: request.reasoningEffort };
        }
      } catch { yield selectionRequired; return; }
    }
    let task;
    try {
      const session = getSession(sessionId);
      task = await tasks.open({ sessionId, turnStartSeq: getTurnStart?.(session), cwd: session?.header?.cwd,
        input: input || (images?.length ? '请查看我附带的图片。' : ''), imageRefs, images,
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
  const adapter = {
    providerInfo: () => ({ id: route, name: '沐码 PI' }),
    providerRetryPolicy: () => ({ mode: 'normal', maxRetries: 0, retryableCodes: [],
      initialDelayMs: 100, maxDelayMs: 100, jitterRatio: 0 }),
    imageRequestPricing: () => undefined,
    imageRequestTarget: (_provider, _model, image) => image,
    listModels: async () => {
      if (!models) return [metadata];
      const profiles = await models.list();
      return [auto(profiles), ...profiles.map(profile => modelInfo(profile))];
    },
    resolveModel,
    prepareCall: async (provider, model) => ({ model: await resolveModel(provider, model), stream }),
    stream,
  };
  adapters.add(adapter);
  return adapter;
}
