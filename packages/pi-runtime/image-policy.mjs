import { Buffer } from 'node:buffer';

/**
 * P03.13.21 上下文图片预算策略。
 *
 * 背景（生产徐-moss-hotal 会话 b94f034a，任务 feaa6f9e）：PI 内置 read/desktop_screenshot
 * 把截图原图（单张 0.4-4.1MB base64）放进 toolResult，多张累积后请求体达 9MB 级；
 * 中转站 413「Input exceeds the context window or request size limit」在上下文压缩后
 * 依旧复现（压缩只减少 token，不清尾部图片字节），任务以 context_limit 终止。
 * PI 默认单图限额是 4.5MB base64（面向 Anthropic 单请求上限），不约束多图累积总量。
 *
 * 策略（两层）：
 * 1. 进上下文前压缩：model 定义注入 inputLimits.images.resize（PI read 工具消费）+
 *    desktop_screenshot 结果经同一预算压缩（保留原始文件落盘，仅模型观察图缩放）。
 * 2. 提交失败兜底：413/request-size 类 context_limit 失败时，把上下文中最大的图片
 *    toolResult 替换为文本占位后重试（sdk-runtime relief，见 sdk-runtime.mjs）。
 */

/** 单张图压缩预算：长边 ≤1568px（常见视觉最优分辨率），base64 ≤512KB，JPEG 质量 80。 */
export const IMAGE_RESIZE_PROFILE = Object.freeze({
  maxWidth: 1568,
  maxHeight: 1568,
  maxBytes: 512 * 1024,
  jpegQuality: 80,
});

/** 原始字节低于该值的图不做任何处理（base64 后约 ≤512KB，已经在预算内）。 */
export const IMAGE_COMPRESS_THRESHOLD_BYTES = 384 * 1024;

/** 单次压缩上限：PI 的 resize worker 无超时保护，卡住时降级为原样透传，不阻塞任务。 */
export const IMAGE_COMPRESS_TIMEOUT_MS = 15000;

/** model 定义（PI ModelDefinitionSchema.inputLimits）里的图片 resize 档位。 */
export function modelInputLimits() {
  return { inputLimits: { images: { resize: { ...IMAGE_RESIZE_PROFILE } } } };
}

/**
 * 构造图片压缩函数（供 desktop_screenshot 等自定义工具把发给模型的图压进预算）。
 *
 * - resizeImage 注入 PI 的 resizeImage（@earendil-works/pi-coding-agent，Photon WASM）。
 *   未提供或压缩失败时原样返回（压缩是尽力而为，不阻塞截图观察）。
 * - timeoutMs 默认 15s：PI 的 resize worker 无超时保护，卡住时降级为原样透传，不阻塞任务。
 * - 返回 { bytes, mimeType, width, height, originalWidth, originalHeight, wasResized }，
 *   wasResized=true 时调用方必须在文本里给出坐标缩放说明（模型按显示尺寸读坐标）。
 */
export function createImageCompressor({ resizeImage, profile = IMAGE_RESIZE_PROFILE, timeoutMs = IMAGE_COMPRESS_TIMEOUT_MS } = {}) {
  return async function compressImage(bytes, mimeType = 'image/png') {
    const passthrough = { bytes, mimeType, wasResized: false };
    if (!bytes || bytes.length <= IMAGE_COMPRESS_THRESHOLD_BYTES) return passthrough;
    if (typeof resizeImage !== 'function') return passthrough;
    let timer;
    try {
      // race settle 后立即清 timer：正常路径不保活事件循环，超时路径由活跃等待触发。
      const resized = await Promise.race([
        resizeImage(new Uint8Array(bytes), mimeType, { ...profile }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('image compress timeout')), timeoutMs);
        }),
      ]).finally(() => clearTimeout(timer));
      if (!resized?.data) return passthrough;
      const out = Buffer.from(resized.data, 'base64');
      if (!(out.length < bytes.length)) return passthrough;
      return {
        bytes: out,
        mimeType: resized.mimeType || mimeType,
        width: resized.width,
        height: resized.height,
        originalWidth: resized.originalWidth,
        originalHeight: resized.originalHeight,
        wasResized: Boolean(resized.wasResized) || out.length < bytes.length,
      };
    } catch {
      return passthrough;
    }
  };
}

/** 异步加载 PI 的 resizeImage（包根导出）；失败返回 null（压缩退化为原样透传）。 */
export async function loadPiResizeImage() {
  try {
    const pi = await import('@earendil-works/pi-coding-agent');
    return typeof pi.resizeImage === 'function' ? pi.resizeImage : null;
  } catch {
    return null;
  }
}

/** 图片 toolResult 的坐标缩放说明（与 PI formatDimensionNote 同格式，供自定义工具复用）。 */
export function resizeScaleNote(info) {
  if (!info?.wasResized || !info.originalWidth || !info.width) return undefined;
  const scale = info.originalWidth / info.width;
  return `[Image: original ${info.originalWidth}x${info.originalHeight}, displayed at ${info.width}x${info.height}. Multiply coordinates by ${scale.toFixed(2)} to map to original image.]`;
}
