import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { createBuiltinPluginRegistry } from '../builtin-plugins/insights';
import { PluginProvider, SlotHost } from '../plugins/slots';
import PluginSection from './PluginSection';
import type { LocalPluginController } from '../plugins/useLocalPlugins';

it('shows the trusted built-in plugin and removes all visible contributions while disabled', async () => {
  const registry = createBuiltinPluginRegistry(); const user = userEvent.setup();
  render(<PluginProvider registry={registry}><PluginSection /><SlotHost slot="composer.trailing" /></PluginProvider>);
  expect(screen.getByText('用量口径助手')).toBeVisible();
  expect(screen.getByText('用量只读取服务商返回值')).toBeVisible();
  const row = screen.getByText('用量口径助手').closest('.plugin-row') as HTMLElement;
  await user.click(within(row).getByRole('button', { name: /^停\s*用$/ }));
  expect(screen.queryByText('用量只读取服务商返回值')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /^启\s*用$/ }));
  expect(screen.getByText('用量只读取服务商返回值')).toBeVisible();
});

it('switches built-in appearances and restores defaults in the plugins page', async () => {
  const apply = vi.fn();
  const user = userEvent.setup();
  render(<PluginSection activeThemeId="ocean" onThemeApply={apply} />);
  await user.click(screen.getByRole('button', { name: '石墨' }));
  expect(apply).toHaveBeenLastCalledWith('graphite');
  await user.click(screen.getByRole('button', { name: '恢复默认外观' }));
  expect(apply).toHaveBeenLastCalledWith('default');
});

it('shows local package type and permissions and routes lifecycle actions', async () => {
  const registry = createBuiltinPluginRegistry(); const user = userEvent.setup();
  const local = { packages: [{ id: 'dev.example.local', name: 'Local', version: '1.0.0', pluginType: 'ui', moosVersion: '^0.1.0', entry: 'main.js', slots: ['composer.trailing'], permissions: ['ui:slots', 'context:read'], enabled: false, manifest: {} }], themes: [], loaded: true,
    install: vi.fn(), setEnabled: vi.fn(), uninstall: vi.fn(), refresh: vi.fn() } as unknown as LocalPluginController;
  render(<PluginProvider registry={registry}><PluginSection local={local} /></PluginProvider>);
  expect(screen.getByText('沙箱 UI')).toBeVisible(); expect(screen.getByText(/ui:slots、context:read/)).toBeVisible();
  await user.click(screen.getByRole('button', { name: '安装 ZIP' })); expect(local.install).toHaveBeenCalledWith('zip');
  await user.click(screen.getAllByRole('button', { name: /^启\s*用$/ }).at(-1)!); expect(local.setEnabled).toHaveBeenCalledWith('dev.example.local', true);
  await user.click(screen.getByRole('button', { name: /^卸\s*载$/ })); await user.click(screen.getByRole('button', { name: '清理并卸载' }));
  expect(local.uninstall).toHaveBeenCalledWith('dev.example.local', true);
});
