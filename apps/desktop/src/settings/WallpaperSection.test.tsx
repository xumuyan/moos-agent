import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import WallpaperSection from './WallpaperSection';
import type { WallpaperConfig, WallpaperOptions } from '../themes/wallpaper';

const fixture = vi.hoisted(() => ({
  current: null as WallpaperConfig | null,
  preview: null as string | null,
  loading: false,
  error: null as string | null,
  listeners: new Set<() => void>(),
  validate: vi.fn(), save: vi.fn(), update: vi.fn(), clear: vi.fn(),
}));

vi.mock('../themes/wallpaper', () => ({
  DEFAULT_WALLPAPER_OPTIONS: { maskOpacity: .22, surfaceOpacity: .82, blur: 8 },
  WALLPAPER_LIMITS: { maskOpacity: { min: 0, max: .75 }, surfaceOpacity: { min: .35, max: 1 }, blur: { min: 0, max: 24 } },
  getWallpaper: () => fixture.current,
  getWallpaperPreview: () => fixture.preview,
  getWallpaperLoadError: () => fixture.error,
  getWallpaperLoading: () => fixture.loading,
  subscribeWallpaper: (listener: () => void) => {
    fixture.listeners.add(listener);
    return () => fixture.listeners.delete(listener);
  },
  validateWallpaper: fixture.validate,
  saveWallpaper: fixture.save,
  updateWallpaperOptions: fixture.update,
  clearWallpaper: fixture.clear,
}));

const defaults = { maskOpacity: .22, surfaceOpacity: .82, blur: 8 };
const metadata = { mime: 'image/png', width: 2, height: 2 } as const;
const previousImage = 'data:image/png;base64,b2xk';
const image = new File(['image fixture'], 'fixture.png', { type: 'image/png' });
const notify = () => fixture.listeners.forEach(listener => listener());

beforeEach(() => {
  fixture.current = null;
  fixture.preview = null;
  fixture.loading = false;
  fixture.error = null;
  fixture.validate.mockReset().mockResolvedValue(metadata);
  fixture.save.mockReset().mockImplementation(async (_file: File, options: WallpaperOptions) => {
    fixture.current = { ...metadata, options };
    fixture.preview = 'data:image/png;base64,bmV3';
    notify();
    return fixture.current;
  });
  fixture.update.mockReset().mockImplementation(async (options: WallpaperOptions) => {
    fixture.current = { ...metadata, options };
    notify();
    return fixture.current;
  });
  fixture.clear.mockReset().mockImplementation(async () => {
    fixture.current = null;
    fixture.preview = null;
    notify();
  });
});

test('validated local image and adjustments remain a preview until explicitly applied', async () => {
  const user = userEvent.setup();
  render(<WallpaperSection />);
  await user.upload(screen.getByLabelText('选择本地背景图片'), image);
  const preview = await screen.findByRole('img', { name: '待应用背景图' });
  expect(preview.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
  expect(fixture.validate).toHaveBeenCalledWith(image);
  expect(fixture.save).not.toHaveBeenCalled();
  const surface = screen.getByRole('slider', { name: '面板透明度' });
  const mask = screen.getByRole('slider', { name: '图片遮罩' });
  const blur = screen.getByRole('slider', { name: '图片模糊' });
  expect(surface).toHaveAttribute('max', '65');
  expect(mask).toHaveAttribute('max', '75');
  expect(blur).toHaveAttribute('max', '24');
  surface.focus();
  expect(surface).toHaveFocus();
  fireEvent.change(surface, { target: { value: '40' } });
  fireEvent.change(mask, { target: { value: '25' } });
  fireEvent.change(blur, { target: { value: '12' } });
  expect(fixture.save).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '应用背景图' }));
  expect(fixture.save).toHaveBeenCalledExactlyOnceWith(image, { maskOpacity: .25, surfaceOpacity: .6, blur: 12 });
  expect(await screen.findByRole('img', { name: '当前背景图' })).toBeVisible();
});

test('invalid selection and failed option save preserve the active image and allow a retry or removal', async () => {
  const user = userEvent.setup();
  fixture.current = { ...metadata, options: defaults };
  fixture.preview = previousImage;
  fixture.validate.mockRejectedValueOnce(new Error('/private/raw-fixture/path'));
  fixture.update.mockRejectedValueOnce(new Error('/private/raw-fixture/write'));
  render(<WallpaperSection />);
  await user.upload(screen.getByLabelText('选择本地背景图片'), image);
  expect(await screen.findByRole('alert')).toHaveTextContent('无法预览此图片');
  expect(screen.queryByText(/\/private\/raw-fixture/)).not.toBeInTheDocument();
  expect(screen.getByRole('img', { name: '当前背景图' })).toHaveAttribute('src', previousImage);
  fireEvent.change(screen.getByRole('slider', { name: '图片模糊' }), { target: { value: '10' } });
  expect(fixture.update).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '保存背景效果' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('未能保存背景');
  expect(fixture.current?.options.blur).toBe(8);
  await user.click(screen.getByRole('button', { name: '保存背景效果' }));
  expect(await screen.findByText('背景已保存并应用。')).toBeVisible();
  expect(fixture.current?.options.blur).toBe(10);
  await user.click(screen.getByRole('button', { name: '移除背景图' }));
  expect(fixture.clear).toHaveBeenCalledOnce();
  expect(screen.queryByRole('img', { name: '当前背景图' })).not.toBeInTheDocument();
});

test('reports startup restore progress and sanitizes restore failures', () => {
  fixture.loading = true;
  render(<WallpaperSection />);
  expect(screen.getByText('正在读取已保存的背景…')).toBeVisible();
  expect(screen.getByRole('button', { name: '选择本地图片' })).toBeDisabled();
  act(() => {
    fixture.loading = false;
    fixture.error = '/private/raw-fixture/data';
    notify();
  });
  expect(screen.getByRole('alert')).toHaveTextContent('读取已保存的背景失败');
  expect(screen.queryByText(/\/private\/raw-fixture/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '选择本地图片' })).toBeEnabled();
});
