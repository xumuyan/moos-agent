import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import Settings from './Settings';

test('does not claim a credential is missing when native status was not queried', () => {
  render(<Settings providers={[{ id: 'local', name: 'Local', baseUrl: 'https://example.test/v1', model: 'model', api: 'openai-completions' }]} runtime={{ taskTimeoutMs: 7200000, allowedTaskTimeouts: [600000, 1800000, 3600000, 7200000, 21600000, 86400000] }} onClose={vi.fn()} mutate={vi.fn()} />);
  expect(screen.queryByText('未保存密钥')).not.toBeInTheDocument();
  expect(screen.getByText('密钥由本机管理')).toBeInTheDocument();
});
