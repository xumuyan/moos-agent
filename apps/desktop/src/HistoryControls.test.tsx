import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import HistoryControls from './HistoryControls';
import type { ConversationHistory } from './types';
test('hides only truly empty counters while preserving scoped history errors', () => {
  const empty = { total: 0, hasMore: false, before: null, requiresScopedPage: false, truncatedRows: [] };
  const page: ConversationHistory = { conversationId: 'c', messages: empty, tasks: empty, events: empty };
  render(<HistoryControls conversationId="c" page={page} isOlder={false} loading={false} error="history fixture failed" onOlder={vi.fn()} onLatest={vi.fn()} />);
  expect(screen.queryByRole('button', { name: '查看更早记录' })).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('history fixture failed');
});
