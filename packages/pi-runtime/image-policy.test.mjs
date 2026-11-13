import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import {
  IMAGE_RESIZE_PROFILE, IMAGE_COMPRESS_THRESHOLD_BYTES, IMAGE_COMPRESS_TIMEOUT_MS,
  modelInputLimits, createImageCompressor, loadPiResizeImage, resizeScaleNote,
} from './image-policy.mjs';

test('image resize profile bounds every image entering context (P03.13.21)', () => {
  // 中转站请求体上限触发的是字节而不是 token：压缩预算必须显著低于 PI 默认单图 4.5MB。
  assert.equal(IMAGE_RESIZE_PROFILE.maxWidth, 1568);
  assert.equal(IMAGE_RESIZE_PROFILE.maxHeight, 1568);
  assert.equal(IMAGE_RESIZE_PROFILE.maxBytes, 512 * 1024);
  assert.equal(IMAGE_RESIZE_PROFILE.jpegQuality, 80);
  assert.ok(IMAGE_COMPRESS_THRESHOLD_BYTES < IMAGE_RESIZE_PROFILE.maxBytes);
  assert.equal(IMAGE_COMPRESS_TIMEOUT_MS, 15000);
  // model 定义注入：PI read 工具按 ctx.model.inputLimits.images.resize 消费。
  const limits = modelInputLimits();
  assert.deepEqual(limits.inputLimits.images.resize, { ...IMAGE_RESIZE_PROFILE });
  // 返回独立对象，避免共享可变状态被模型配置改动。
  assert.notEqual(limits.inputLimits.images.resize, IMAGE_RESIZE_PROFILE);
});

test('compressor passes small images through untouched', async () => {
  let called = 0;
  const compress = createImageCompressor({ resizeImage: () => { called += 1; throw new Error('must not be called'); } });
  const small = Buffer.alloc(1024, 7);
  const result = await compress(small, 'image/png');
  assert.equal(result.bytes, small);
  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.wasResized, false);
  assert.equal(called, 0);
});

test('compressor compresses oversized images and reports scale metadata', async () => {
  const big = { data: 'x'.repeat(800 * 1024), width: 3000, height: 2000, originalWidth: 3000, originalHeight: 2000, mimeType: 'image/jpeg' };
  const compress = createImageCompressor({
    resizeImage: async () => ({ ...big, data: 'y'.repeat(200 * 1024), width: 1568, height: 1045, wasResized: true }),
  });
  const result = await compress(Buffer.alloc(600 * 1024), 'image/png');
  assert.equal(result.mimeType, 'image/jpeg');
  assert.equal(result.wasResized, true);
  assert.equal(result.width, 1568);
  assert.equal(result.height, 1045);
  assert.equal(result.originalWidth, 3000);
  assert.ok(result.bytes.length < 600 * 1024);
  const note = resizeScaleNote(result);
  assert.match(note, /original 3000x2000, displayed at 1568x1045\. Multiply coordinates by 1\.91/);
});

test('compressor falls back to the original image when resize fails or times out', async () => {
  const bytes = Buffer.alloc(600 * 1024, 9);
  const failing = createImageCompressor({ resizeImage: async () => { throw new Error('photon exploded'); } });
  const failed = await failing(bytes, 'image/png');
  assert.equal(failed.bytes, bytes);
  assert.equal(failed.wasResized, false);

  const hanging = createImageCompressor({ resizeImage: () => new Promise(() => {}), timeoutMs: 50 });
  const timedOut = await hanging(bytes, 'image/png');
  assert.equal(timedOut.bytes, bytes);
  assert.equal(timedOut.wasResized, false);

  // 压缩结果不小于原图时没有收益，同样原样透传。（'y'.repeat(900*1024) base64 解码后 675KB ≥ 600KB）
  const useless = createImageCompressor({ resizeImage: async () => ({ data: 'y'.repeat(900 * 1024) }) });
  const unchanged = await useless(bytes, 'image/png');
  assert.equal(unchanged.bytes, bytes);
  assert.equal(unchanged.wasResized, false);
});

test('compressor without resizeImage dependency passes everything through', async () => {
  const compress = createImageCompressor();
  const bytes = Buffer.alloc(600 * 1024, 3);
  const result = await compress(bytes, 'image/png');
  assert.equal(result.bytes, bytes);
  assert.equal(result.wasResized, false);
  // resizeScaleNote 对未缩放图返回 undefined（不附加坐标说明）。
  assert.equal(resizeScaleNote(result), undefined);
});

test('PI runtime exposes resizeImage for the compressor (installed 1.5.0 contract)', async () => {
  const resizeImage = await loadPiResizeImage();
  assert.equal(typeof resizeImage, 'function');
});
