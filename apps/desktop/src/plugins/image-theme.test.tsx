import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { createPluginRegistry } from './registry';
import { useLocalPlugins } from './useLocalPlugins';
import { applyTheme, resetTheme, THEME_STORAGE_KEY } from '../themes/loader';
import { BUILTIN_THEMES } from '../themes/builtin';
import * as wallpaper from '../themes/wallpaper';
import App from '../App';
import { emptySnapshot } from '../types';
import { request } from '../api';

vi.mock('../api', () => ({ request: vi.fn() }));

const source = 'data:image/png;base64,iVBORw0KGgo=';
const theme = {
  id: 'dev.example.image', name: '薄暮皮肤', version: '1.0.0', pluginType: 'theme', moosVersion: '^0.1.0',
  slots: [], permissions: [], enabled: false,
  manifest: { tokens: {}, styles: {}, assets: {}, backgroundMedia: { type: 'image', src: 'assets/dusk.png', maskOpacity: .3 } },
};

afterEach(() => { resetTheme(); vi.mocked(wallpaper.decodeThemeBackground).mockRestore(); vi.unstubAllGlobals(); });

function mockInstaller({ corrupt = false, ui = false } = {}) {
  let installed = false;
  let enabled = false;
  const bytes = new ArrayBuffer(8);
  const decode = vi.spyOn(wallpaper, 'decodeThemeBackground');
  if (corrupt) decode.mockRejectedValue(new Error('invalid image'));
  else decode.mockResolvedValue(source);
  const pkg = ui ? { ...theme, pluginType: 'ui' } : theme;
  const invoke = vi.fn(async (command: string, args?: { id: string; enabled: boolean }) => {
    if (command === 'list_local_plugins') return installed ? [{ ...pkg, enabled }] : [];
    if (command === 'pick_plugin_zip') return '/tmp/skin.zip';
    if (command === 'install_local_plugin') { installed = true; return pkg; }
    if (command === 'set_local_plugin_enabled') { enabled = args!.enabled; return; }
    if (command === 'load_local_theme_background' && enabled) return bytes;
    throw new Error(`Unexpected command ${command}`);
  });
  vi.stubGlobal('isTauri', true);
  vi.stubGlobal('__TAURI_INTERNALS__', { invoke });
  vi.mocked(request).mockResolvedValue(emptySnapshot);
  return { invoke, decode, bytes };
}

it('applies the installed image skin immediately and falls back when disabled', async () => {
  const { invoke, decode, bytes } = mockInstaller();
  const root = document.documentElement;
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: '插件' }));
  await user.click(screen.getByRole('button', { name: '安装 ZIP' }));
  await waitFor(() => expect(root.dataset.moosSkinWallpaper).toBe('true'));
  expect(invoke).toHaveBeenCalledWith('load_local_theme_background', { id: theme.id }, undefined);
  expect(decode).toHaveBeenCalledWith(bytes);
  expect(invoke.mock.calls.some(([command]) => command === 'load_local_plugin_entry')).toBe(false);
  expect(screen.getByText('使用中', { exact: true })).toBeVisible();
  expect(root.style.getPropertyValue('--moos-skin-mask')).toBe('0.3');
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe(theme.id);
  const row = screen.getByText(theme.name).closest('.plugin-row')!;
  await user.click(row.querySelectorAll('button')[0]);
  await waitFor(() => expect(root.dataset.moosSkinWallpaper).toBeUndefined());
  expect(root.style.getPropertyValue('--moos-skin-image')).toBe('');
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
});

it('keeps the current appearance when the installed skin cannot decode', async () => {
  mockInstaller({ corrupt: true });
  applyTheme(BUILTIN_THEMES[1], { persist: true });
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: '插件' }));
  await user.click(screen.getByRole('button', { name: '安装 ZIP' }));
  expect(await screen.findByText(/已安装，但无法应用/)).toBeVisible();
  expect(screen.getByText(`${theme.id} · 1.0.0 · 已停用`)).toBeVisible();
  expect(document.documentElement.dataset.moosTheme).toBe('graphite');
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('graphite');
});

it('does not auto-enable installed UI plugins', async () => {
  const { invoke, decode } = mockInstaller({ ui: true });
  const registry = createPluginRegistry();
  const { result } = renderHook(() => useLocalPlugins(registry));
  await waitFor(() => expect(result.current.loaded).toBe(true));
  await act(() => result.current.install('zip'));
  expect(result.current.packages[0].enabled).toBe(false);
  expect(decode).not.toHaveBeenCalled();
  expect(invoke.mock.calls.some(([command]) => command === 'set_local_plugin_enabled')).toBe(false);
});

it('drops an obsolete decode when the plugin is disabled during loading', async () => {
  let enabled = true;
  let resolveImage!: (src: string) => void;
  const decode = vi.spyOn(wallpaper, 'decodeThemeBackground').mockImplementation(() => new Promise(resolve => { resolveImage = resolve; }));
  vi.stubGlobal('isTauri', true);
  vi.stubGlobal('__TAURI_INTERNALS__', { invoke: vi.fn(async (command: string) => {
    if (command === 'list_local_plugins') return [{ ...theme, enabled }];
    if (command === 'set_local_plugin_enabled') { enabled = false; return; }
    if (command === 'load_local_theme_background') return new ArrayBuffer(8);
  }) });
  const registry = createPluginRegistry();
  const { result } = renderHook(() => useLocalPlugins(registry));
  await waitFor(() => expect(decode).toHaveBeenCalled());
  await act(() => result.current.setEnabled(theme.id, false));
  await act(async () => resolveImage(source));
  expect(result.current.packages[0].enabled).toBe(false);
  expect(result.current.themes).toEqual([]);
});
