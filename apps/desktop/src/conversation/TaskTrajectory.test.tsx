import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import TaskTrajectory from './TaskTrajectory';

it('shows compact real activity without raw payloads', () => {
  render(<TaskTrajectory events={[
    { id: 'e1', type: 'tool_start', taskId: 't1', projectId: 'p1', conversationId: 'c1', payload: { name: 'bash', command: 'npm test', apiKey: 'do-not-render' } },
    { id: 'e2', type: 'tool_end', taskId: 't1', projectId: 'p1', conversationId: 'c1', payload: { name: 'bash', output: '12 tests passed', status: 'completed' } },
  ]} />);
  expect(screen.getAllByText('运行命令').length).toBeGreaterThan(0);
  expect(screen.queryByText(/npm test/)).not.toBeInTheDocument();
  expect(screen.queryByText(/12 tests passed/)).not.toBeInTheDocument();
  expect(screen.queryByText(/do-not-render|思维链|隐藏推理/)).not.toBeInTheDocument();
});

it('collapses finished activity and lists only successful file changes', () => {
  render(<TaskTrajectory finished events={[
    { id: '1', type: 'tool_start', taskId: 't', projectId: 'p', conversationId: 'c', payload: { toolCallId: 'a', toolName: 'edit', args: { path: 'src/a.ts', newText: 'hidden-code' } } },
    { id: '2', type: 'tool_end', taskId: 't', projectId: 'p', conversationId: 'c', payload: { toolCallId: 'a', toolName: 'edit', isError: false } },
  ]} />);
  expect(screen.getByText(/查看执行过程/).closest('details')).not.toHaveAttribute('open');
  expect(screen.getByRole('region', { name: '修改文件汇总' })).toHaveTextContent('src/a.ts');
  expect(screen.getByText('局部修改')).toBeVisible();
  expect(screen.queryByText('hidden-code')).not.toBeInTheDocument();
});
