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

it('keeps shell-only caveats inside the process disclosure while file summaries retain their limit', () => {
  const base = { taskId: 't', projectId: 'p', conversationId: 'c' };
  const shell = [
    { ...base, id: '1', type: 'tool_start', payload: { toolCallId: 's', toolName: 'bash' } },
    { ...base, id: '2', type: 'tool_end', payload: { toolCallId: 's', toolName: 'bash' } },
  ];
  const { rerender } = render(<TaskTrajectory finished events={shell} />);
  expect(screen.getByText(/文件清单仅统计/)).not.toBeVisible();
  rerender(<TaskTrajectory finished events={[...shell,
    { ...base, id: '3', type: 'tool_start', payload: { toolCallId: 'w', toolName: 'write', args: { path: 'app.ts' } } },
    { ...base, id: '4', type: 'tool_end', payload: { toolCallId: 'w', toolName: 'write' } },
  ]} />);
  expect(screen.getByText('文件清单不含命令产生的改动。')).toBeVisible();
});
