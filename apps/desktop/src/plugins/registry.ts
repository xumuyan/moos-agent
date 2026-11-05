import type { ReactNode } from 'react';
import { validatePluginManifest, type PluginManifest, type PluginSlot } from './manifest';

export interface SlotContribution { slot: PluginSlot; render: (context?: unknown) => ReactNode; activate?: () => (() => void) }
export interface PluginState extends PluginManifest { enabled: boolean; errorCount: number; disabledReason?: string }
interface Installed { manifest: PluginManifest; contributions: SlotContribution[]; cleanups: (() => void)[]; enabled: boolean; errorCount: number; disabledReason?: string }
export interface PluginRegistry {
  register(manifest: unknown, contributions: SlotContribution[]): { revoke: () => void };
  contributions(slot: PluginSlot): { pluginId: string; render: SlotContribution['render'] }[];
  list(): PluginState[];
  setEnabled(id: string, enabled: boolean): void;
  reportError(id: string): void;
  subscribe(listener: () => void): () => void;
  version(): number;
}

export function createPluginRegistry(): PluginRegistry {
  const installed = new Map<string, Installed>(); const listeners = new Set<() => void>(); let revision = 0;
  const changed = () => { revision++; for (const listener of listeners) listener(); };
  const activate = (item: Installed) => { item.cleanups = item.contributions.flatMap(entry => entry.activate ? [entry.activate()] : []); };
  const deactivate = (item: Installed) => { for (const cleanup of item.cleanups.splice(0)) { try { cleanup(); } catch { /* Plugin cleanup is isolated. */ } } };
  return {
    register(input, contributions) {
      const manifest = validatePluginManifest(input);
      if (installed.has(manifest.id)) throw new Error('Duplicate plugin id');
      if (!Array.isArray(contributions) || contributions.some(item => !item || typeof item.render !== 'function' || (item.activate !== undefined && typeof item.activate !== 'function') || !manifest.slots.includes(item.slot))) throw new Error('Plugin contribution uses an undeclared slot');
      if (contributions.length && !manifest.permissions.includes('ui:slots')) throw new Error('Plugin lacks slot permission');
      const item = { manifest, contributions: [...contributions], cleanups: [], enabled: true, errorCount: 0 }; activate(item); installed.set(manifest.id, item); changed();
      let revoked = false;
      return { revoke() { if (revoked) return; revoked = true; const current = installed.get(manifest.id); if (current) deactivate(current); installed.delete(manifest.id); changed(); } };
    },
    contributions(slot) { return [...installed.values()].filter(item => item.enabled).flatMap(item => item.contributions.filter(entry => entry.slot === slot).map(entry => ({ pluginId: item.manifest.id, render: entry.render }))); },
    list() { return [...installed.values()].map(item => ({ ...item.manifest, slots: [...item.manifest.slots], permissions: [...item.manifest.permissions], enabled: item.enabled, errorCount: item.errorCount, ...(item.disabledReason ? { disabledReason: item.disabledReason } : {}) })); },
    setEnabled(id, enabled) { const item = installed.get(id); if (!item) throw new Error('Plugin not found'); if (item.enabled === enabled) return; item.enabled = enabled; if (enabled) { item.errorCount = 0; item.disabledReason = undefined; activate(item); } else deactivate(item); changed(); },
    reportError(id) { const item = installed.get(id); if (!item || !item.enabled) return; item.errorCount++; if (item.errorCount >= 3) { item.enabled = false; item.disabledReason = 'render_error_limit'; deactivate(item); } changed(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    version() { return revision; },
  };
}
