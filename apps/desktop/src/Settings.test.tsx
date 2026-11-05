import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import Settings from './Settings';

it('omits an empty API key when editing an existing service', async () => {
  const mutate = vi.fn().mockResolvedValue(true);
  const user = userEvent.setup();
  render(<Settings providers={[{ id: 'glm', name: '自定义 GLM', baseUrl: 'https://example.test/v1', model: 'user-model', api: 'openai-completions', hasKey: true }]} onClose={vi.fn()} mutate={mutate} />);
  await user.click(screen.getByRole('button', { name: /编\s*辑/ }));
  expect(screen.getByLabelText('API 密钥')).toHaveValue('');
  await user.click(screen.getByRole('button', { name: '保存服务' }));
  await waitFor(() => expect(mutate).toHaveBeenCalledWith('save_provider', { provider: { id: 'glm', name: '自定义 GLM', baseUrl: 'https://example.test/v1', model: 'user-model', api: 'openai-completions' } }));
});
