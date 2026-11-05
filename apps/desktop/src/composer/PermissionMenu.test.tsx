import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it } from 'vitest';
import PermissionMenu from './PermissionMenu';

beforeEach(() => localStorage.clear());

it('defaults to assisted approval and preserves the fixed safe order', async () => {
  const user = userEvent.setup();
  render(<PermissionMenu />);
  expect(screen.getByRole('button', { name: /帮我批准/ })).toBeVisible();
  await user.click(screen.getByRole('button', { name: /帮我批准/ }));
  const items = screen.getAllByRole('menuitem');
  expect(items.map(item => item.textContent)).toEqual(expect.arrayContaining([
    expect.stringMatching(/^请求批准/), expect.stringMatching(/^帮我批准/), expect.stringMatching(/^完全访问权限/),
  ]));
  expect(items[0]).toHaveTextContent('请求批准');
  expect(items[1]).toHaveTextContent('帮我批准');
  expect(items[2]).toHaveTextContent('完全访问权限');
});

it('persists only the UI preference and states that system permissions cannot be bypassed', async () => {
  const user = userEvent.setup();
  const view = render(<PermissionMenu />);
  await user.click(screen.getByRole('button', { name: /帮我批准/ }));
  await user.click(screen.getByRole('menuitem', { name: /完全访问权限/ }));
  expect(localStorage.getItem('moos.permission-mode')).toBe('full');
  expect(screen.getByText(/不能绕过 macOS/)).toBeVisible();
  expect(screen.getByText('计划中')).toBeVisible();
  view.unmount();
  render(<PermissionMenu />);
  expect(screen.getByRole('button', { name: /完全访问权限/ })).toBeVisible();
});
