import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import TaskStatus from './TaskStatus';
import type { Task } from '../types';

const task: Task = { id: 't', projectId: 'p', conversationId: 'c', message: '修改文件', status: 'failed', error: 'Task execution failed', errorCode: 'UPSTREAM' };
it('shows one concise failure and preserves the actual error in collapsed details', async () => {
  render(<TaskStatus task={task} onStop={vi.fn()} />);
  expect(screen.getByRole('alert')).toHaveTextContent('任务执行失败');
  expect(screen.getByText('Task execution failed')).not.toBeVisible();
  await userEvent.click(screen.getByText('查看错误详情'));
  expect(screen.getByText('Task execution failed')).toBeVisible();
  expect(screen.getByText('错误码：UPSTREAM')).toBeVisible();
  expect(screen.queryByText('已完成')).not.toBeInTheDocument();
});
it('retains cancellation for running tasks and truthfully labels stopped tasks', async () => {
  const stop = vi.fn();
  const { rerender } = render(<TaskStatus task={{ ...task, status: 'running', error: undefined, errorCode: undefined }} onStop={stop} />);
  await userEvent.click(screen.getByRole('button', { name: '停止此任务' }));
  expect(stop).toHaveBeenCalledOnce();
  rerender(<TaskStatus task={{ ...task, status: 'cancelled' }} onStop={stop} />);
  expect(screen.getByRole('status')).toHaveTextContent('已停止');
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByText('任务执行失败')).not.toBeInTheDocument();
  expect(screen.getByText('Task execution failed')).not.toBeVisible();
});
