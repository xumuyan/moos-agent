import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { createPluginRegistry } from './registry';
import { useLocalPlugins } from './useLocalPlugins';
import { applyTheme, loadSavedTheme, resetTheme, THEME_STORAGE_KEY } from '../themes/loader';
import * as wallpaper from '../themes/wallpaper';
import ThemeSection from '../settings/ThemeSection';

const source = 'data:image/png;base64,iVBORw0KGgo=';
const theme = {
  id: 'dev.example.image', name: '薄暮皮肤', version: '1.0.0', pluginType: 'theme', moosVersion: '^0.1.0',
  slots: [], permissions: [], enabled: false,
  manifest: { tokens: {}, styles: {}, assets: {}, backgroundMedia: { type: 'image', src: 'assets/dusk.png', maskOpacity: .3 } },
};

afterEach(() => { resetTheme(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('installs a static theme, previews its private asset, and clears it when disabled', async () => {
  let installed = false;
  let enabled = false;
  const bytes = new ArrayBuffer(8);
  const decode = vi.spyOn(wallpaper, 'decodeThemeBackground').mockResolvedValue(source);
  const invoke = vi.fn(async (command: string, args?: { id: string; enabled: boolean }) => {
    if (command === 'list_local_plugins') return installed ? [{ ...theme, enabled }] : [];
    if (command === 'pick_plugin_zip') return '/tmp/skin.zip';
    if (command === 'install_local_plugin') { installed = true; return theme; }
    if (command === 'set_local_plugin_enabled') { enabled = args!.enabled; return; }
    if (command === 'load_local_theme_background') return bytes;
    throw new Error(`Unexpected command ${command}`);
  });
  vi.stubGlobal('isTauri', true);
  vi.stubGlobal('__TAURI_INTERNALS__', { invoke });
  const registry = createPluginRegistry();
  const { result } = renderHook(() => useLocalPlugins(registry));
  await waitFor(() => expect(result.current.loaded).toBe(true));
  await act(() => result.current.install('zip'));
  expect(result.current.packages).toHaveLength(1);
  expect(result.current.themes).toEqual([]);
  expect(decode).not.toHaveBeenCalled();
  await act(() => result.current.setEnabled(theme.id, true));
  expect(invoke).toHaveBeenCalledWith('load_local_theme_background', { id: theme.id }, undefined);
  expect(decode).toHaveBeenCalledWith(bytes);
  expect(registry.list()).toEqual([]);

  const active = result.current.themes[0];
  const root = document.documentElement;
  const user = userEvent.setup();
  render(<ThemeSection themes={[active]} activeId="default" onApply={() => applyTheme(active, { persist: true })} />);
  expect(screen.getByRole('img', { name: '皮肤背景预览' })).toHaveAttribute('src', source);
  expect(screen.queryByRole('button', { name: '选择本地图片' })).not.toBeInTheDocument();
  expect(root.dataset.moosSkinWallpaper).toBeUndefined();
  await user.click(screen.getByRole('button', { name: '应用此皮肤' }));
  expect(root.dataset.moosSkinWallpaper).toBe('true');
  expect(root.style.getPropertyValue('--moos-skin-mask')).toBe('0.3');
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe(theme.id);
  expect(loadSavedTheme(result.current.themes)).toBe(theme.id);
  await act(() => result.current.setEnabled(theme.id, false));
  expect(loadSavedTheme(result.current.themes)).toBe('default');
  expect(root.dataset.moosSkinWallpaper).toBeUndefined();
  expect(root.style.getPropertyValue('--moos-skin-image')).toBe('');
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
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
