import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { createBuiltinPluginRegistry } from '../builtin-plugins/insights';
import { PluginProvider, SlotHost } from '../plugins/slots';
import { BUILTIN_THEMES } from '../themes/builtin';
import PluginSection from './PluginSection';
import ThemeSection from './ThemeSection';
import type { LocalPluginController } from '../plugins/useLocalPlugins';

it('shows the trusted built-in plugin and removes all visible contributions while disabled', async () => {
  const registry = createBuiltinPluginRegistry(); const user = userEvent.setup();
  render(<PluginProvider registry={registry}><PluginSection /><SlotHost slot="composer.trailing" /></PluginProvider>);
  expect(screen.getByText('用量口径助手')).toBeVisible();
  expect(screen.getByText('用量只读取服务商返回值')).toBeVisible();
  await user.click(screen.getByRole('button', { name: /^停\s*用$/ }));
  expect(screen.queryByText('用量只读取服务商返回值')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /^启\s*用$/ }));
  expect(screen.getByText('用量只读取服务商返回值')).toBeVisible();
});

it('keeps preview isolated and applies only after the explicit action', async () => {
  const apply = vi.fn(); const user = userEvent.setup();
  render(<ThemeSection themes={BUILTIN_THEMES} activeId="default" onApply={apply} />);
  await user.click(screen.getByRole('button', { name: '石墨' }));
  expect(screen.getByLabelText('预览 石墨')).toBeVisible();
  expect(apply).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '应用此皮肤' }));
  expect(apply).toHaveBeenCalledWith('graphite');
  await user.click(screen.getByRole('button', { name: 'Moos 默认' }));
  expect(apply).toHaveBeenCalledWith('default');
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
