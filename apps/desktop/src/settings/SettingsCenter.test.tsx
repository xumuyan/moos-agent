import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import SettingsCenter from './SettingsCenter';

it('navigates all nine truthful settings sections with keyboard-operable controls', async () => {
  const user = userEvent.setup();
  const runtime = { taskTimeoutMs: 7200000, allowedTaskTimeouts: [600000, 1800000, 3600000, 7200000, 21600000, 86400000] };
  render(<SettingsCenter open onClose={() => {}} modelContent={<div>模型密钥由本机管理</div>}
    usageContent={<div>真实用量面板</div>} runtime={runtime} onTaskTimeoutChange={async () => true} />);
  for (const name of ['通用', '模型服务', '权限', '用量', '插件', '主题', '隐私', '手机连接', '高级']) {
    expect(screen.getByRole('tab', { name })).toBeInTheDocument();
  }
  await user.click(screen.getByRole('tab', { name: '用量' }));
  expect(screen.getByText('真实用量面板')).toBeInTheDocument();
  await user.click(screen.getByRole('tab', { name: '模型服务' }));
  expect(screen.getByText('模型密钥由本机管理')).toBeInTheDocument();
  await user.click(screen.getByRole('tab', { name: '高级' }));
  expect(screen.getByRole('combobox', { name: '单任务运行时长上限' })).toBeInTheDocument();
  expect(screen.getByText('2 小时')).toBeInTheDocument();
  expect(screen.getByText(/心跳不是模型输出/)).toBeInTheDocument();
});

it('keeps the restyled settings dialog dismissible without changing a setting', async () => {
  const onClose = vi.fn();
  const changeTimeout = vi.fn();
  render(<SettingsCenter open onClose={onClose} modelContent={<div>模型配置</div>}
    usageContent={<div>用量</div>} runtime={{ taskTimeoutMs: 7200000, allowedTaskTimeouts: [7200000] }} onTaskTimeoutChange={changeTimeout} />);
  await userEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(changeTimeout).not.toHaveBeenCalled();
});


it('links each DSH navigation tab to the actual panel and supports arrow, home and end navigation', async () => {
  const user = userEvent.setup();
  render(<SettingsCenter open onClose={() => {}} modelContent={<div>真实模型配置</div>}
    usageContent={<div>真实用量</div>} runtime={{ taskTimeoutMs: 7200000, allowedTaskTimeouts: [7200000] }} onTaskTimeoutChange={async () => true} />);
  const models = screen.getByRole('tab', { name: '模型服务' });
  models.focus();
  expect(models).toHaveAttribute('tabindex', '0');
  expect(screen.getByRole('tabpanel', { name: '模型服务' })).toHaveAttribute('id', models.getAttribute('aria-controls'));
  await user.keyboard('{ArrowDown}');
  expect(screen.getByRole('tab', { name: '权限' })).toHaveFocus();
  expect(screen.getByRole('tabpanel', { name: '权限' })).toBeInTheDocument();
  expect(models).toHaveAttribute('tabindex', '-1');
  await user.keyboard('{End}');
  expect(screen.getByRole('tabpanel', { name: '高级' })).toBeInTheDocument();
  await user.keyboard('{ArrowDown}');
  expect(screen.getByRole('tabpanel', { name: '通用' })).toBeInTheDocument();
  await user.keyboard('{ArrowUp}{Home}');
  expect(screen.getByRole('tab', { name: '通用' })).toHaveFocus();
});
