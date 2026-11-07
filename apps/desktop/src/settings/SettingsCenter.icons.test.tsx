import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import SettingsCenter from './SettingsCenter';

test('decorative navigation icons do not add spoken names or interrupt keyboard panel selection', async () => {
  render(<SettingsCenter open onClose={() => {}} modelContent={<div>model fixture</div>} usageContent={<div>usage fixture</div>}
    runtime={{ taskTimeoutMs:7200000, allowedTaskTimeouts:[7200000] }} onTaskTimeoutChange={async () => true} />);
  const nav = screen.getByRole('tablist', { name:'设置分区' });
  expect(within(nav).queryByRole('img')).toBeNull();
  const tabs = within(nav).getAllByRole('tab');
  expect(tabs.map(tab => tab.getAttribute('aria-controls'))).toEqual(Array(9).fill('settings-panel'));
  const models = screen.getByRole('tab', { name:'模型服务' });
  models.focus();
  await userEvent.keyboard('{ArrowUp}');
  expect(screen.getByRole('tab', { name:'通用' })).toHaveFocus();
  await waitFor(() => expect(screen.getByRole('tabpanel', { name:'通用' })).toBeVisible());
  await userEvent.keyboard('{End}');
  expect(screen.getByRole('tab', { name:'高级' })).toHaveFocus();
  await waitFor(() => expect(screen.getByRole('tabpanel', { name:'高级' })).toBeVisible());
});
