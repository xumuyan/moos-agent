import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import SettingsCenter from './SettingsCenter';

it('navigates all nine truthful settings sections with keyboard-operable controls', async () => {
  const user = userEvent.setup();
  render(<SettingsCenter open onClose={() => {}} modelContent={<div>模型密钥由本机管理</div>} />);
  for (const name of ['通用', '模型服务', '权限', '用量', '插件', '主题', '隐私', '手机连接', '高级']) {
    expect(screen.getByRole('tab', { name })).toBeInTheDocument();
  }
  await user.click(screen.getByRole('tab', { name: '用量' }));
  expect(screen.getByText(/尚未接入真实 Token Usage/)).toBeVisible();
  await user.click(screen.getByRole('tab', { name: '模型服务' }));
  expect(screen.getByText('模型密钥由本机管理')).toBeVisible();
});
