import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import UsageSection from './UsageSection';

const summary = {
  range: 'today', recordCount: 2, inputTokens: 120, outputTokens: 30, totalTokens: 170,
  cacheReadTokens: 20, cacheWriteTokens: null, cacheHitRate: 20 / 140,
  reasoningTokens: null, costUsd: null, contextTokens: 170, contextWindow: 1000,
};

it('shows verified usage, unavailable values and supports range/filter refresh and clearing', async () => {
  const user = userEvent.setup();
  const load = vi.fn().mockResolvedValue(summary);
  const clear = vi.fn().mockResolvedValue(2);
  render(<UsageSection providers={[{ id: 'p', name: 'Provider', model: 'model', baseUrl: 'https://example.test', api: 'openai-completions' }]}
    projects={[{ id: 'project', name: 'Project', path: '/tmp/project' }]}
    conversations={[{ id: 'conversation', projectId: 'project', title: 'Chat' }]}
    loadUsage={load} clearUsage={clear} exportUsage={vi.fn().mockResolvedValue({ records: [], truncated: false })} />);
  await waitFor(() => expect(load).toHaveBeenCalledWith({ range: 'today' }));
  expect(await screen.findByText('120')).toBeInTheDocument();
  expect(screen.getByText('14.3%')).toBeInTheDocument();
  expect(screen.getAllByText('暂无数据').length).toBeGreaterThan(0);
  await user.selectOptions(screen.getByLabelText('统计时间范围'), '7d');
  await waitFor(() => expect(load).toHaveBeenLastCalledWith({ range: '7d' }));
  await user.click(screen.getByRole('button', { name: '清空用量记录' }));
  await user.click(await screen.findByRole('button', { name: '确认清空' }));
  await waitFor(() => expect(clear).toHaveBeenCalled());
});
