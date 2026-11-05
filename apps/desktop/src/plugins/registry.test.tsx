import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { createPluginRegistry } from './registry';
import { PluginProvider, SlotHost } from './slots';

const manifest = { id: 'dev.moos.test', name: 'Test', version: '1.0.0', type: 'ui' as const,
  moosVersion: '^0.1.0', entry: 'builtin:test', slots: ['sidebar.footer' as const], permissions: ['ui:slots' as const] };

it('registers typed contributions, rejects duplicates and revokes idempotently without residue', () => {
  const registry = createPluginRegistry();
  const listener = vi.fn(); const cleanup = vi.fn(); registry.subscribe(listener);
  const handle = registry.register(manifest, [{ slot: 'sidebar.footer', render: () => <span>extension ready</span>, activate: () => cleanup }]);
  expect(() => registry.register(manifest, [])).toThrow(/duplicate/i);
  const view = render(<PluginProvider registry={registry}><SlotHost slot="sidebar.footer" /></PluginProvider>);
  expect(screen.getByText('extension ready')).toBeVisible();
  registry.setEnabled(manifest.id, false); view.rerender(<PluginProvider registry={registry}><SlotHost slot="sidebar.footer" /></PluginProvider>);
  expect(screen.queryByText('extension ready')).not.toBeInTheDocument();
  expect(cleanup).toHaveBeenCalledTimes(1);
  registry.setEnabled(manifest.id, true); handle.revoke(); handle.revoke();
  expect(cleanup).toHaveBeenCalledTimes(2);
  expect(registry.list()).toEqual([]);
  expect(listener).toHaveBeenCalled();
});

it('disables a plugin after three isolated rendering failures without breaking the host', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const registry = createPluginRegistry();
  registry.register(manifest, [{ slot: 'sidebar.footer', render: () => { throw new Error('plugin boom'); } }]);
  const mount = () => render(<PluginProvider registry={registry}><div>host alive</div><SlotHost slot="sidebar.footer" /></PluginProvider>);
  for (let index = 0; index < 3; index++) { const view = mount(); expect(screen.getByText('host alive')).toBeVisible(); view.unmount(); }
  expect(registry.list()[0]).toMatchObject({ enabled: false, errorCount: 3, disabledReason: 'render_error_limit' });
  error.mockRestore();
});
