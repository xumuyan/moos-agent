export const PLUGIN_SLOTS = [
  'sidebar.primary', 'sidebar.footer', 'conversation.header', 'conversation.message', 'conversation.tool',
  'composer.leading', 'composer.trailing', 'rightPanel.tab', 'settings.section', 'usage.metric',
] as const;
export type PluginSlot = typeof PLUGIN_SLOTS[number];
export const PLUGIN_PERMISSIONS = ['ui:slots', 'ui:notifications', 'theme:read'] as const;
export type PluginPermission = typeof PLUGIN_PERMISSIONS[number];
export interface PluginManifest { id: string; name: string; version: string; type: 'ui'; moosVersion: string; entry: string; slots: PluginSlot[]; permissions: PluginPermission[] }
const VERSION = '0.1.0';
const semver = (value: unknown): value is string => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);
export function isMoosCompatible(range: string, current = VERSION) {
  if (semver(range)) return range === current;
  const match = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range); const installed = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!match || !installed) return false;
  const [, major, minor, patch] = match.map(Number), [, ownMajor, ownMinor, ownPatch] = installed.map(Number);
  if (ownMajor !== major) return false;
  return major === 0 ? ownMinor === minor && ownPatch >= patch : ownMinor > minor || (ownMinor === minor && ownPatch >= patch);
}
export function validatePluginManifest(input: unknown): PluginManifest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid plugin manifest');
  const value = input as Record<string, unknown>;
  if (typeof value.id !== 'string' || !/^[a-z][a-z0-9]*(\.[a-z0-9-]+)+$/.test(value.id) || value.id.length > 100) throw new Error('Invalid plugin id');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100) throw new Error('Invalid plugin name');
  if (!semver(value.version)) throw new Error('Invalid plugin version');
  if (value.type !== 'ui') throw new Error('Invalid plugin type');
  if (typeof value.moosVersion !== 'string' || !isMoosCompatible(value.moosVersion)) throw new Error('Plugin is not compatible with this Moos version');
  if (typeof value.entry !== 'string' || !/^builtin:[a-z0-9-]+$/.test(value.entry)) throw new Error('Invalid plugin entry');
  if (!Array.isArray(value.slots) || !value.slots.length || value.slots.some(slot => !PLUGIN_SLOTS.includes(slot as PluginSlot)) || new Set(value.slots).size !== value.slots.length) throw new Error('Invalid plugin slot');
  if (!Array.isArray(value.permissions) || value.permissions.some(permission => !PLUGIN_PERMISSIONS.includes(permission as PluginPermission)) || new Set(value.permissions).size !== value.permissions.length) throw new Error('Invalid plugin permission');
  return { id: value.id, name: value.name.trim(), version: value.version, type: 'ui', moosVersion: value.moosVersion,
    entry: value.entry, slots: [...value.slots] as PluginSlot[], permissions: [...value.permissions] as PluginPermission[] };
}
