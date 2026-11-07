import { message } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { validateTheme, type ThemeDefinition } from '../themes/schema';
import { decodeThemeBackground } from '../themes/wallpaper';
import { validatePluginManifest } from './manifest';
import type { PluginRegistry } from './registry';
import SandboxContribution from './sandbox/SandboxContribution';
import { PluginSandbox } from './sandbox/runtime';
import { enableLocalPlugin, getLocalPluginConfig, installLocalPlugin, listLocalPlugins, loadLocalPluginEntry, loadLocalThemeBackground, pickLocalPlugin, setLocalPluginConfig, uninstallLocalPlugin, type LocalPluginPackage } from './local-api';

interface Active { version: string; revoke: () => void; sandbox: PluginSandbox }

export function useLocalPlugins(registry: PluginRegistry) {
  const [packages, setPackages] = useState<LocalPluginPackage[]>([]);
  const [themes, setThemes] = useState<ThemeDefinition[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string>();
  const active = useRef(new Map<string, Active>());
  const themeRefresh = useRef(0);

  const stop = useCallback((id: string) => { const item = active.current.get(id); if (!item) return; item.sandbox.stop(); item.revoke(); active.current.delete(id); }, []);
  const refresh = useCallback(async () => {
    const generation = ++themeRefresh.current;
    try {
      const next = await listLocalPlugins();
      if (generation !== themeRefresh.current) return;
      setPackages(next);
      setError(undefined);
      const ids = new Set(next.filter(item => item.enabled && item.pluginType === 'ui').map(item => item.id));
      for (const id of active.current.keys()) if (!ids.has(id)) stop(id);
      for (const item of next) {
        if (!item.enabled || item.pluginType !== 'ui' || active.current.get(item.id)?.version === item.version) continue;
        stop(item.id);
        try {
          const manifest = validatePluginManifest({ ...item, type: 'ui', entry: item.entry }, { local: true });
          const source = await loadLocalPluginEntry(item.id);
          const sandbox = new PluginSandbox({ manifest, source,
            onFailure: reason => { void enableLocalPlugin(item.id, false).finally(() => { stop(item.id); void refresh(); }); setError(`${item.name} 已停用：${reason}`); },
            onNotify: text => void message.info(`${item.name}：${text}`),
            getConfig: () => getLocalPluginConfig(item.id), setConfig: value => setLocalPluginConfig(item.id, value),
          });
          const handle = registry.register(manifest, manifest.slots.map(slot => ({ slot, render: context => <SandboxContribution sandbox={sandbox} slot={slot} context={context} /> })), { local: true });
          active.current.set(item.id, { version: item.version, revoke: handle.revoke, sandbox }); sandbox.start();
        } catch { await enableLocalPlugin(item.id, false); setPackages(current => current.map(plugin => plugin.id === item.id ? { ...plugin, enabled: false } : plugin)); setError(`${item.name} 加载失败，已自动停用。`); }
      }
      const available: ThemeDefinition[] = [];
      for (const item of next.filter(item => item.enabled && item.pluginType === 'theme')) {
        if (generation !== themeRefresh.current) return;
        try {
          const manifest: Record<string, unknown> = { ...item.manifest, id: item.id, name: item.name, version: item.version, moosVersion: item.moosVersion };
          if (manifest.backgroundMedia !== undefined) {
            const src = await decodeThemeBackground(await loadLocalThemeBackground(item.id));
            manifest.backgroundMedia = { ...(manifest.backgroundMedia as object), src };
          }
          available.push(validateTheme(manifest));
        } catch {
          if (generation === themeRefresh.current) setError(`${item.name} 无法加载，请检查皮肤包中的背景图片和配置。`);
        }
      }
      if (generation === themeRefresh.current) setThemes(available);
    } catch { setError('无法读取本地插件。'); }
    finally { if (generation === themeRefresh.current) setLoaded(true); }
  }, [registry, stop]);

  useEffect(() => { void refresh(); return () => { themeRefresh.current++; for (const id of [...active.current.keys()]) stop(id); }; }, [refresh, stop]);
  const install = async (kind: 'zip' | 'folder') => { try { const path = await pickLocalPlugin(kind); if (!path) return; await installLocalPlugin(path); await refresh(); } catch { setError('安装失败：包不安全、不兼容或无法读取。'); } };
  const setEnabled = async (id: string, enabled: boolean) => { try { await enableLocalPlugin(id, enabled); await refresh(); } catch { setError('无法更改插件状态。'); } };
  const uninstall = async (id: string, clearConfig: boolean) => { try { stop(id); await uninstallLocalPlugin(id, clearConfig); await refresh(); } catch { setError('卸载失败，原安装状态已保留。'); } };
  return { packages, themes, loaded, error, install, setEnabled, uninstall, refresh };
}
export type LocalPluginController = ReturnType<typeof useLocalPlugins>;
