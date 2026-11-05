import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableLocalPlugin, installLocalPlugin, listLocalPlugins, pickLocalPlugin, uninstallLocalPlugin } from './local-api';

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe('local plugin native bridge', () => {
  it('uses only dedicated native plugin commands', async () => {
    const invoke = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce('/tmp/plugin.zip').mockResolvedValue(undefined);
    vi.stubGlobal('isTauri', true); vi.stubGlobal('__TAURI_INTERNALS__', { invoke });
    expect(await listLocalPlugins()).toEqual([]);
    expect(await pickLocalPlugin('zip')).toBe('/tmp/plugin.zip');
    await installLocalPlugin('/tmp/plugin.zip'); await enableLocalPlugin('dev.example.plugin', true); await uninstallLocalPlugin('dev.example.plugin', true);
    expect(invoke.mock.calls.map(call => call[0])).toEqual(['list_local_plugins', 'pick_plugin_zip', 'install_local_plugin', 'set_local_plugin_enabled', 'uninstall_local_plugin']);
    expect(invoke).toHaveBeenCalledWith('uninstall_local_plugin', { id: 'dev.example.plugin', clearConfig: true }, undefined);
  });

  it('does not expose a browser HTTP fallback for local packages', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(await listLocalPlugins()).toEqual([]);
    await expect(pickLocalPlugin('folder')).rejects.toThrow(/Moos/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
