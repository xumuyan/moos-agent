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

it('navigates real right-panel sections by keyboard and delegates explicit close', async () => {
  const close = vi.fn();
  render(<RightPanel projectName="临时项目" projectPath="/fixture" activeTasks={1} onClose={close} />);
  const user = userEvent.setup();
  const files = screen.getByRole('tab', { name: '变更' });
  files.focus(); await user.keyboard('{ArrowRight}');
  expect(screen.getByRole('tab', { name: '任务' })).toHaveFocus();
  expect(screen.getByRole('tabpanel')).toHaveTextContent('/fixture');
  await user.keyboard('{End}'); expect(screen.getByRole('tab', { name: '插件' })).toHaveFocus();
  expect(screen.getByRole('tabpanel')).toHaveTextContent('已启用插件的工具面板');
  await user.click(screen.getByRole('button', { name: '收起上下文面板' })); expect(close).toHaveBeenCalledOnce();
});
