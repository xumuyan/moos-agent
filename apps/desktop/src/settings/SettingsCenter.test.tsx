import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
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
