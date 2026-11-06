import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import TurnProcess from './TurnProcess';
import type { AgentEvent, Task } from '../types';

const task: Task = { id: 't', projectId: 'p', conversationId: 'c', message: '修复页面', status: 'failed', error: 'upstream unavailable', errorCode: 'UPSTREAM' };
const events: AgentEvent[] = ['read', 'read', 'grep', 'edit', 'bash'].map((name, index) => ({ id: String(index), taskId: 't', projectId: 'p', conversationId: 'c', type: 'tool_start', payload: { toolCallId: String(index), toolName: name, args: { path: `src/${index}.ts` } } }));
it('combines status, groups and error behind one disclosure without changing tool order', async () => {
  render(<TurnProcess task={task} events={events} onStop={vi.fn()} />);
  const status = screen.getByRole('alert');
  expect(status).toHaveTextContent('失败 · 5 项操作');
  expect(screen.getByText('upstream unavailable')).not.toBeVisible();
  expect(screen.queryByText('查看错误详情')).not.toBeInTheDocument();
  await userEvent.click(status);
  expect(screen.getByText('upstream unavailable')).toBeVisible();
  expect(screen.getByText('错误码：UPSTREAM')).toBeVisible();
  expect(screen.getAllByRole('region').slice(1).map(node => node.getAttribute('aria-label'))).toEqual(['读取与浏览工具组', '搜索内容工具组', '编辑文件工具组', '运行命令工具组']);
  expect(screen.getByText('读取文件 · src/0.ts')).toBeVisible();
  expect(screen.queryByText('已完成')).not.toBeInTheDocument();
});
it('shows live work and a working stop control, then folds a cancelled turn', async () => {
  const stop = vi.fn();
  const { rerender } = render(<TurnProcess task={{ ...task, status: 'running', error: undefined, errorCode: undefined }} events={events} onStop={stop} />);
  expect(screen.getByText('读取文件 · src/0.ts')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: '停止此任务' }));
  expect(stop).toHaveBeenCalledOnce();
  rerender(<TurnProcess task={{ ...task, status: 'cancelled' }} events={events} onStop={stop} />);
  expect(screen.getByRole('status')).toHaveTextContent('已停止 · 5 项操作');
  expect(screen.getByText('读取文件 · src/0.ts')).not.toBeVisible();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
