import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import ComposerStatus from './ComposerStatus';

it('shows only verified cache and context values with threshold status', () => {
  const { rerender } = render(<ComposerStatus projectName="Project" backgroundTasks={1}
    usage={{ conversationId: 'c', taskId: 't1', cacheHitRate: 0.25, totalTokens: 860, contextWindow: 1000 }} />);
  expect(screen.getByText(/缓存命中 25.0%/)).toBeInTheDocument();
  expect(screen.getByText(/上下文 860 \/ 1,000/)).toHaveClass('usage-warning');
  rerender(<ComposerStatus projectName="Project" backgroundTasks={0}
    usage={{ conversationId: 'c', taskId: 't2', cacheHitRate: null, totalTokens: 10, contextWindow: null }} />);
  expect(screen.getByText(/缓存命中 暂无数据/)).toBeInTheDocument();
  expect(screen.getByText(/上下文 暂无数据/)).toBeInTheDocument();
});
