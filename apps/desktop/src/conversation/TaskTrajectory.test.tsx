import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import TaskTrajectory from './TaskTrajectory';

it('shows only real events with safe summaries and never fabricates hidden reasoning', () => {
  render(<TaskTrajectory events={[
    { id: 'e1', type: 'tool_start', taskId: 't1', projectId: 'p1', conversationId: 'c1', payload: { name: 'bash', command: 'npm test', apiKey: 'do-not-render' } },
    { id: 'e2', type: 'tool_end', taskId: 't1', projectId: 'p1', conversationId: 'c1', payload: { name: 'bash', output: '12 tests passed', status: 'completed' } },
  ]} />);
  expect(screen.getAllByText(/bash/).length).toBeGreaterThan(0);
  expect(screen.getByText(/npm test/)).toBeVisible();
  expect(screen.getByText(/12 tests passed/)).toBeVisible();
  expect(screen.queryByText(/do-not-render|思维链|隐藏推理/)).not.toBeInTheDocument();
});
