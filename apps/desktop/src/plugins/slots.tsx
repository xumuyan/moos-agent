import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { PluginSlot } from './manifest';
import { createPluginRegistry, type PluginRegistry } from './registry';
import PluginBoundary from './PluginBoundary';

const Context = createContext<PluginRegistry>(createPluginRegistry());
export function PluginProvider({ registry, children }: { registry: PluginRegistry; children: ReactNode }) { return <Context.Provider value={registry}>{children}</Context.Provider>; }
export function usePluginRegistry() { return useContext(Context); }
function Contribution({ render, context }: { render: (context?: unknown) => ReactNode; context?: unknown }) { return <>{render(context)}</>; }
export function SlotHost({ slot, context }: { slot: PluginSlot; context?: unknown }) {
  const registry = usePluginRegistry(); useSyncExternalStore(registry.subscribe, registry.version, registry.version);
  const entries = registry.contributions(slot);
  return <>{entries.map((entry, index) => <PluginBoundary key={`${entry.pluginId}:${index}`} pluginId={entry.pluginId} onError={registry.reportError}>
    <Contribution render={entry.render} context={context} />
  </PluginBoundary>)}</>;
}
