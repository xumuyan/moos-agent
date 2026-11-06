import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import ProjectRail from './ProjectRail';
import RightPanel from './RightPanel';

it('switches projects and opens real project/settings actions', async () => {
  const select = vi.fn(), add = vi.fn(), settings = vi.fn();
  render(<ProjectRail projects={[{ id: 'a', name: '项目甲', path: '/a' }, { id: 'b', name: '项目乙', path: '/b' }]} selectedId="a" onSelect={select} onAdd={add} onSettings={settings} adding={false} />);
  const user = userEvent.setup();
  expect(screen.getByRole('button', { name: '切换到项目 项目甲' })).toHaveAttribute('aria-current', 'page');
  await user.click(screen.getByRole('button', { name: '切换到项目 项目乙' })); expect(select).toHaveBeenCalledWith('b');
  await user.click(screen.getByRole('button', { name: '添加工作区' })); expect(add).toHaveBeenCalledOnce();
  await user.click(screen.getByRole('button', { name: '打开设置中心' })); expect(settings).toHaveBeenCalledOnce();
});

it('shows only confirmed changes and does not invent validation results', () => {
  const base = { taskId: 't', projectId: 'p', conversationId: 'c' };
  render(<RightPanel activeTasks={0} taskStatus="failed" events={[
    { ...base, id: '1', type: 'tool_start', payload: { toolCallId: 'a', toolName: 'edit', args: { path: 'src/a.ts' } } },
    { ...base, id: '2', type: 'tool_end', payload: { toolCallId: 'a', toolName: 'edit', isError: false } },
    { ...base, id: '3', type: 'tool_start', payload: { toolCallId: 'b', toolName: 'write', args: { path: 'bad.ts' } } },
    { ...base, id: '4', type: 'tool_end', payload: { toolCallId: 'b', toolName: 'write', isError: true } },
  ]} />);
  expect(screen.getByText('src/a.ts')).toBeVisible();
  expect(screen.queryByText('bad.ts')).not.toBeInTheDocument();
  expect(screen.getByText('失败')).toBeVisible();
  expect(screen.queryByText('测试通过')).not.toBeInTheDocument();
});
