import { chmod, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Type } from 'typebox';

export const IMAGE_TOOL_NAME = 'generate_image';
export const IMAGE_CONFIG_FILENAME = 'image-gen.json';

const SIZES = ['1024x1024', '1536x1024', '1024x1536', 'auto'];
const QUALITIES = ['auto', 'low', 'medium', 'high'];
const BACKGROUNDS = ['auto', 'transparent', 'opaque'];
const FORMATS = ['png', 'jpeg', 'webp'];
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

/** 图片服务配置位于运行时数据目录 private/image-gen.json（0700 目录 + 0600 文件）。 */
export function imageGenConfigPath(dataDir) {
  return join(dataDir, 'private', IMAGE_CONFIG_FILENAME);
}

/** 供任务会话装配时判断工具是否挂载：只看存在性，不解析内容（解析延迟到真正调用时）。 */
export async function imageGenConfigExists(dataDir) {
  try {
    await lstat(imageGenConfigPath(dataDir));
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function readOwnerOnlyText(path) {
  let status;
  try {
    status = await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`未找到图片服务配置 ${path}。请在终端创建该文件后重试。`);
    throw error;
  }
  if (status.isSymbolicLink()) throw new Error('图片服务配置不允许是符号链接');
  if (status.mode & 0o077) throw new Error(`图片服务配置权限过宽（${(status.mode & 0o777).toString(8)}）。密钥文件必须仅限本人读取，请执行 chmod 600 后重试。`);
  return readFile(path, 'utf8');
}

function requireText(value, field) {
  if (typeof value !== 'string' || !value.trim() || value.length > 16384 || /[\r\n\x00]/.test(value)) {
    throw new Error(`图片服务配置 ${field} 无效：需要 1..16384 字符且不含换行的字符串`);
  }
  return value.trim();
}

/** 解析并校验 image-gen.json。缺少 baseUrl/apiKey 或取值非法时抛出带修复指引的错误；model 省略时默认 gpt-image-2.5-flare（云桥图片专用分组模型，key 需绑定该分组才能调用）。 */
export function parseImageGenConfig(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('图片服务配置不是有效 JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('图片服务配置必须是 JSON 对象');
  let baseUrl = requireText(parsed.baseUrl, 'baseUrl');
  if (!/^https?:\/\//.test(baseUrl)) throw new Error('图片服务配置 baseUrl 必须以 http:// 或 https:// 开头');
  if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
  const apiKey = requireText(parsed.apiKey, 'apiKey');
  const model = parsed.model === undefined ? 'gpt-image-2.5-flare' : requireText(parsed.model, 'model');
  const defaults = parsed.defaults ?? {};
  if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) throw new Error('图片服务配置 defaults 必须是对象');
  const pick = (field, allowed, fallback) => {
    if (defaults[field] === undefined) return fallback;
    if (!allowed.includes(defaults[field])) throw new Error(`图片服务配置 defaults.${field} 只允许 ${allowed.join('/')}`);
    return defaults[field];
  };
  return {
    baseUrl, apiKey, model,
    defaults: {
      size: pick('size', SIZES, 'auto'),
      quality: pick('quality', QUALITIES, 'high'),
      background: pick('background', BACKGROUNDS, 'auto'),
      output_format: pick('output_format', FORMATS, 'png'),
    },
  };
}

async function loadImageGenConfig(dataDir) {
  return parseImageGenConfig(await readOwnerOnlyText(imageGenConfigPath(dataDir)));
}

const schema = Type.Object({
  prompt: Type.String({ description: '画面描述：主体、风格、构图、颜色等，用一句完整的中文或英文描述', minLength: 1, maxLength: 8000 }),
  size: Type.Optional(Type.Union(SIZES.map(value => Type.Literal(value)), { description: '画布尺寸。默认 auto 由服务按画面内容自动选择；也可按聊天中用户描述的构图显式选：1536x1024 横图 / 1024x1536 竖图 / 1024x1024 方图' })),
  quality: Type.Optional(Type.Union(QUALITIES.map(value => Type.Literal(value)), { description: `渲染质量，默认取配置（high）。质量越高越慢、费用越高` })),
  background: Type.Optional(Type.Union(BACKGROUNDS.map(value => Type.Literal(value)), { description: '背景处理：transparent 需要配合 png/webp 输出' })),
  output_format: Type.Optional(Type.Union(FORMATS.map(value => Type.Literal(value)), { description: '输出格式，默认 png' })),
  output_compression: Type.Optional(Type.Integer({ minimum: 0, maximum: 100, description: '压缩率 0-100，仅 jpeg/webp 有效' })),
});

function slug(text) {
  const normalized = text.replace(/[\p{C}\p{Z}]+/gu, ' ').trim()
    .replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/-{2,}/gu, '-').replace(/^-+|-+$/gu, '');
  return (normalized || 'image').slice(0, 24);
}

function resolveFormat(input, defaults) {
  const format = input.output_format ?? defaults.output_format;
  const background = input.background ?? defaults.background;
  if (background === 'transparent' && format === 'jpeg') {
    throw new Error('参数组合无效：透明背景只能输出 png 或 webp，请调整 output_format 或 background');
  }
  const compression = input.output_compression;
  if (compression !== undefined && format === 'png') {
    throw new Error('参数组合无效：output_compression 仅适用于 jpeg 或 webp 输出');
  }
  return { format, background, compression };
}

async function decodeImagePayload(payload, requestInit, signal) {
  const entry = Array.isArray(payload?.data) ? payload.data[0] : undefined;
  if (typeof entry?.b64_json === 'string' && entry.b64_json.length > 0) {
    const data = Buffer.from(entry.b64_json, 'base64');
    if (data.length === 0 || data.length > MAX_IMAGE_BYTES) {
      throw new Error(`图片服务返回的数据大小异常（${data.length} 字节），已丢弃不落盘`);
    }
    return data;
  }
  if (typeof entry?.url === 'string' && /^https?:\/\//.test(entry.url)) {
    const response = await fetch(entry.url, { ...requestInit, signal });
    if (!response.ok) throw new Error(`图片服务返回的下载地址不可用（HTTP ${response.status}）`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
      throw new Error(`下载的图片大小异常（${buffer.length} 字节），已丢弃不落盘`);
    }
    return buffer;
  }
  throw new Error('图片服务响应缺少图片数据（data[0].b64_json 或 url）');
}

function mapHttpError(status, bodyText) {
  let detail = '';
  try {
    const parsed = JSON.parse(bodyText);
    detail = typeof parsed?.error?.message === 'string' ? parsed.error.message
      : typeof parsed?.message === 'string' ? parsed.message : '';
  } catch { /* 保留空 detail */ }
  const suffix = detail ? `：${detail.slice(0, 300)}` : '';
  if (status === 401 || status === 403) return `图片服务认证失败（HTTP ${status}）${suffix}。请检查 image-gen.json 的 apiKey、分组与权限`;
  if (status === 429) return `图片服务限流或额度不足（HTTP 429）${suffix}。请稍后重试或检查套餐额度`;
  if (status === 400 || status === 404 || status === 422) return `图片请求被服务拒绝（HTTP ${status}）${suffix}。请检查 model、size 等参数是否为该服务支持的取值`;
  return `图片服务暂时不可用（HTTP ${status}）${suffix}`;
}

/**
 * 创建「生成图片」PI 自定义工具。未配置图片服务时返回 null（模型看不到该工具）。
 * 每次调用恰好发起一次付费请求：无自动重试，取消信号直接中止网络请求，密钥只存在于本工具内。
 */
export async function createImageTool({ cwd, dataDir, getMode }) {
  if (!await imageGenConfigExists(dataDir)) return null;
  const imagesDir = join(cwd, 'images');
  const mode = getMode ?? (() => 'danger-full-access');
  return {
    name: IMAGE_TOOL_NAME,
    label: '生成图片',
    description: '调用图片生成服务，根据文字描述生成一张图片并保存到项目工作区 images/ 目录。'
      + '仅在用户明确要求生成、绘制、创作图片，或当前任务必需一张新图片时调用；不要为测试、演练或顺手演示调用。'
      + '尺寸按聊天内容决定：用户说明了横/竖/方构图或用途（如壁纸、海报、头像）就选对应 size，未说明时留空由服务自动选择。'
      + '每次调用都会向图片服务发起一次真实计费请求，本工具不自动重试。',
    promptSnippet: '用户需要新图片时生成一张并保存到工作区 images/ 目录，构图按对话内容自动选择',
    promptGuidelines: [
      '调用 generate_image 前先与用户确认或依据任务明确需要，一次只生成一张图。',
      '尺寸根据聊天内容自行决定：明确提到方向或用途时显式传横图 1536x1024、竖图 1024x1536 或方图 1024x1024，否则不传 size 由服务按内容自动选择，不要反复追问尺寸。',
      '生成成功后把保存的相对路径告诉用户；失败时如说明认证、额度或参数原因，不要反复重试。',
    ],
    parameters: schema,
    async execute(toolCallId, input, signal) {
      signal?.throwIfAborted();
      const current = mode();
      if (current === 'read-only') throw new Error('当前会话为只读权限，生成图片需要写入工作区，已拒绝执行');
      const config = await loadImageGenConfig(dataDir);
      const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : '';
      if (!prompt) throw new Error('请先提供画面描述（prompt）');
      const { format, background, compression } = resolveFormat(input, config.defaults);
      const body = {
        model: config.model, prompt,
        size: input.size ?? config.defaults.size,
        quality: input.quality ?? config.defaults.quality,
        background, output_format: format, n: 1,
        ...(compression !== undefined ? { output_compression: compression } : {}),
      };
      const started = performance.now();
      let response;
      try {
        response = await fetch(`${config.baseUrl}/images/generations`, {
          method: 'POST',
          headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        });
      } catch (error) {
        if (signal?.aborted || error.name === 'AbortError') throw error;
        throw new Error(`无法连接图片服务（${config.baseUrl}）：${error.cause?.code ?? error.message}`);
      }
      if (!response.ok) throw new Error(mapHttpError(response.status, (await response.text()).slice(0, 2000)));
      let payload;
      try {
        payload = JSON.parse(await response.text());
      } catch {
        throw new Error('图片服务返回了非 JSON 响应');
      }
      const data = await decodeImagePayload(payload, { headers: { authorization: `Bearer ${config.apiKey}` } }, signal);
      signal?.throwIfAborted();
      await mkdir(imagesDir, { recursive: true });
      const filename = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${slug(prompt)}.${format}`;
      const target = resolve(imagesDir, filename);
      if (!within(imagesDir, target)) throw new Error('生成的保存路径异常，已拒绝写入');
      await writeFile(target, data);
      await chmod(target, 0o600);
      const seconds = ((performance.now() - started) / 1000).toFixed(1);
      const text = `图片已生成并保存到 ${relative(cwd, target)}（${body.size} / quality=${body.quality} / ${format}`
        + `，${data.length} 字节，用时 ${seconds} 秒）`;
      return {
        content: [{ type: 'text', text }],
        details: { path: relative(cwd, target), bytes: data.length, size: body.size,
          quality: body.quality, format, model: config.model, durationMs: Math.round(performance.now() - started) },
      };
    },
  };
}

function within(root, target) {
  const path = relative(root, target);
  return path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path);
}
