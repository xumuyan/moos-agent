import { invoke, isTauri } from '@tauri-apps/api/core';
import type { PluginPermission, PluginSlot } from './manifest';

export interface LocalPluginPackage {
  id: string; name: string; version: string; pluginType: 'ui' | 'theme'; moosVersion: string; entry?: string;
  slots: PluginSlot[]; permissions: PluginPermission[]; enabled: boolean; manifest: Record<string, unknown>;
}

export async function listLocalPlugins() { return isTauri() ? invoke<LocalPluginPackage[]>('list_local_plugins') : []; }
export async function pickLocalPlugin(kind: 'zip' | 'folder') { if (!isTauri()) throw new Error('请在 Moos 桌面应用中安装本地插件'); return invoke<string | null>(kind === 'zip' ? 'pick_plugin_zip' : 'pick_plugin_folder'); }
export async function installLocalPlugin(path: string) { return invoke<LocalPluginPackage>('install_local_plugin', { path }); }
export async function enableLocalPlugin(id: string, enabled: boolean) { return invoke<void>('set_local_plugin_enabled', { id, enabled }); }
export async function uninstallLocalPlugin(id: string, clearConfig: boolean) { return invoke<void>('uninstall_local_plugin', { id, clearConfig }); }
export async function loadLocalPluginEntry(id: string) { return invoke<string>('load_local_plugin_entry', { id }); }
export async function getLocalPluginConfig(id: string) { return invoke<Record<string, unknown>>('get_local_plugin_config', { id }); }
export async function setLocalPluginConfig(id: string, value: unknown) { return invoke<void>('set_local_plugin_config', { id, value }); }
