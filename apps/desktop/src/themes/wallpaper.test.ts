import { expect, test, vi } from 'vitest';
import {
  createWallpaperManager, DEFAULT_WALLPAPER_OPTIONS, MAX_WALLPAPER_BYTES,
  type WallpaperStorage,
} from './wallpaper';

const imageProperty = '--moos-wallpaper-image';
const pngBytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJdkAAAAASUVORK5CYII='), c => c.charCodeAt(0));
const png = () => new File([pngBytes], 'local.png', { type: 'image/png' });

function fixture() {
  let stored: Awaited<ReturnType<WallpaperStorage['read']>> = null;
  const storage = {
    read: vi.fn(async () => stored),
    write: vi.fn(async (value: typeof stored) => { stored = value; }),
  };
  const decode = vi.fn(async () => ({ width: 1, height: 1 }));
  const root = document.createElement('html');
  const manager = createWallpaperManager(storage, decode, () => root);
  return { manager, storage, decode, root };
}

test('rejects disguised SVG and MIME mismatch before image decode', async () => {
  const { manager, decode, storage } = fixture();
  const script = new File(['<svg onload="alert(1)"/>'], 'wall.png', { type: 'image/png' });
  await expect(manager.saveWallpaper(script)).rejects.toThrow(/有效/);
  const wrongType = new File([pngBytes], 'wall.webp', { type: 'image/webp' });
  await expect(manager.saveWallpaper(wrongType)).rejects.toThrow(/不一致/);
  expect(decode).not.toHaveBeenCalled();
  expect(storage.write).not.toHaveBeenCalled();
});

test('rejects excess bytes and declared pixels before decoding, then verifies decoded dimensions', async () => {
  const { manager, decode } = fixture();
  const oversized = new File([new Uint8Array(MAX_WALLPAPER_BYTES + 1)], 'wall.png');
  await expect(manager.saveWallpaper(oversized)).rejects.toThrow(/8 MB/);
  const largeHeader = new Uint8Array(pngBytes);
  const view = new DataView(largeHeader.buffer);
  view.setUint32(16, 5000);
  view.setUint32(20, 5000);
  await expect(manager.saveWallpaper(new File([largeHeader], 'wall.png'))).rejects.toThrow(/2000 万/);
  expect(decode).not.toHaveBeenCalled();
  decode.mockResolvedValueOnce({ width: 2, height: 1 });
  await expect(manager.saveWallpaper(png())).rejects.toThrow(/尺寸/);
  decode.mockRejectedValueOnce(new Error('无法解码'));
  await expect(manager.saveWallpaper(png())).rejects.toThrow(/无法解码/);
});

test('recognizes JPEG frame dimensions and WebP lossless dimensions', async () => {
  const { manager, decode } = fixture();
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 8, 8, 0, 1, 0, 2, 1, 0xff, 0xd9]);
  decode.mockResolvedValueOnce({ width: 1, height: 2 });
  await expect(manager.saveWallpaper(new File([jpeg], 'wall.jpg', { type: 'image/jpeg' })))
    .resolves.toMatchObject({ mime: 'image/jpeg', width: 1, height: 2 });

  const webp = Uint8Array.from([
    82, 73, 70, 70, 18, 0, 0, 0, 87, 69, 66, 80,
    86, 80, 56, 76, 5, 0, 0, 0, 0x2f, 0, 0, 0, 0, 0,
  ]);
  await expect(manager.saveWallpaper(new File([webp], 'wall.webp', { type: 'image/webp' })))
    .resolves.toMatchObject({ mime: 'image/webp', width: 1, height: 1 });
  expect(decode).toHaveBeenLastCalledWith(expect.stringMatching(/^data:image\/webp;base64,/));
});

test('a failed replacement, option write, or clear preserves the applied image and settings', async () => {
  const { manager, storage, root } = fixture();
  const original = await manager.saveWallpaper(png(), { blur: 4 });
  const previous = root.style.getPropertyValue(imageProperty);
  const listener = vi.fn();
  const unsubscribe = manager.subscribeWallpaper(listener);
  storage.write.mockRejectedValueOnce(new Error('存储已满'));
  await expect(manager.saveWallpaper(png(), { blur: 20 })).rejects.toThrow('存储已满');
  storage.write.mockRejectedValueOnce(new Error('存储已满'));
  await expect(manager.updateWallpaperOptions({ blur: 16 })).rejects.toThrow('存储已满');
  storage.write.mockRejectedValueOnce(new Error('存储已满'));
  await expect(manager.clearWallpaper()).rejects.toThrow('存储已满');
  expect(manager.getWallpaper()).toBe(original);
  expect(root.dataset.moosWallpaper).toBe('true');
  expect(root.style.getPropertyValue(imageProperty)).toBe(previous);
  expect(root.style.getPropertyValue('--moos-wallpaper-blur')).toBe('4px');
  expect(listener).not.toHaveBeenCalled();
  unsubscribe();
});

test('reloads saved options in a new manager, applies local image, and clears both persistence and styles', async () => {
  const { manager, storage, decode } = fixture();
  const saved = await manager.saveWallpaper(png(), { maskOpacity: 0.75, surfaceOpacity: 0.35, blur: 24 });
  const root = document.createElement('html');
  const reloaded = createWallpaperManager(storage, decode, () => root);
  const result = reloaded.loadWallpaper();
  expect(reloaded.getWallpaperLoading()).toBe(true);
  expect(reloaded.loadWallpaper()).toBe(result);
  await expect(result).resolves.toEqual(saved);
  expect(reloaded.getWallpaperLoading()).toBe(false);
  expect(storage.read).toHaveBeenCalledTimes(1);
  expect(root.style.getPropertyValue(imageProperty)).toMatch(/^url\("data:image\/png;base64,/);
  expect(root.style.getPropertyValue('--moos-wallpaper-mask-opacity')).toBe('0.75');
  expect(root.style.getPropertyValue('--moos-wallpaper-surface-opacity')).toBe('0.35');
  expect(root.style.getPropertyValue('--moos-wallpaper-blur')).toBe('24px');
  expect(reloaded.getWallpaperPreview()).toMatch(/^data:image\/png;base64,/);
  await reloaded.clearWallpaper();
  expect(root.dataset.moosWallpaper).toBeUndefined();
  expect(root.style.length).toBe(0);
  expect(reloaded.getWallpaperPreview()).toBeNull();
  await expect(reloaded.loadWallpaper()).resolves.toBeNull();
});

test('rejects out-of-range and nonnumeric options, and serializes updates in invocation order', async () => {
  const { manager, storage, root } = fixture();
  await expect(manager.saveWallpaper(png(), { surfaceOpacity: 0.34 })).rejects.toThrow(/范围/);
  expect(storage.write).not.toHaveBeenCalled();
  await manager.saveWallpaper(png());
  expect(manager.getWallpaper()?.options).toEqual(DEFAULT_WALLPAPER_OPTIONS);
  await expect(manager.updateWallpaperOptions({ blur: Number.NaN })).rejects.toThrow(/范围/);
  await expect(manager.updateWallpaperOptions({ maskOpacity: 0.751 })).rejects.toThrow(/范围/);
  await expect(manager.updateWallpaperOptions({ blur: 'url(example)' as unknown as number })).rejects.toThrow(/范围/);
  const change = manager.updateWallpaperOptions({ blur: 0 });
  const clear = manager.clearWallpaper();
  await expect(change).resolves.toMatchObject({ options: { blur: 0 } });
  await clear;
  expect(manager.getWallpaper()).toBeNull();
  expect(root.dataset.moosWallpaper).toBeUndefined();
  await expect(storage.read()).resolves.toBeNull();
});

test('reports reload failure without clearing the previous background', async () => {
  const { manager, storage } = fixture();
  await manager.saveWallpaper(png());
  const preview = manager.getWallpaperPreview();
  storage.read.mockRejectedValueOnce(new Error('read failed'));
  await expect(manager.loadWallpaper()).rejects.toThrow(/无法读取/);
  expect(manager.getWallpaperLoading()).toBe(false);
  expect(manager.getWallpaperLoadError()).toMatch(/无法读取/);
  expect(manager.getWallpaperPreview()).toBe(preview);
});
