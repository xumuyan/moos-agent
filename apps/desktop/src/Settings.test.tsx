import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import Settings from './Settings';
import { request } from './api';

vi.mock('./api', () => ({ request: vi.fn() }));
beforeEach(() => vi.mocked(request).mockReset());
const provider = { id: 'glm', name: '自定义 GLM', baseUrl: 'https://example.test/v1', model: 'user-model', api: 'openai-completions' as const, hasKey: true };
const success = { ok: true, code: 'ok', message: '连接成功', elapsedMs: 42 };
function deferred() {
  let resolve!: (value: typeof success) => void;
  const promise = new Promise<typeof success>(done => { resolve = done; });
  return { promise, resolve };
}
async function draft(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText('服务地址'));
  await user.paste('https://draft.test/v1');
}

it('lists models from an unsaved nameless draft and retains manual model input', async () => {
  vi.mocked(request).mockResolvedValue({ ...success, models: ['listed-model', 'another-model'] });
  const mutate = vi.fn();
  const user = userEvent.setup();
  render(<Settings providers={[]} onClose={vi.fn()} mutate={mutate} />);
  await draft(user);
  await user.type(screen.getByLabelText('API 密钥'), 'draft-secret');
  await user.click(screen.getByRole('button', { name: '获取模型列表' }));
  expect(await screen.findByText(/连接成功/)).toBeVisible();
  expect(screen.getByText(/42 ms/)).toBeVisible();
  expect(request).toHaveBeenCalledWith('list_models', { provider: { baseUrl: 'https://draft.test/v1', api: 'openai-completions', model: undefined }, apiKey: 'draft-secret' });
  await user.click(screen.getByLabelText('模型 ID'));
  await user.click(await screen.findByText('listed-model', { selector: '.ant-select-item-option-content' }));
  expect(screen.getByLabelText('模型 ID')).toHaveValue('listed-model');
  expect(screen.queryByText(/连接成功/)).not.toBeInTheDocument();
  await user.clear(screen.getByLabelText('模型 ID'));
  await user.type(screen.getByLabelText('模型 ID'), 'manual-model');
  expect(screen.getByLabelText('模型 ID')).toHaveValue('manual-model');
  expect(mutate).not.toHaveBeenCalled();
});

it('tests the current edited draft with a blank saved key and no service name requirement', async () => {
  vi.mocked(request).mockResolvedValue(success);
  const mutate = vi.fn();
  const user = userEvent.setup();
  render(<Settings providers={[provider]} onClose={vi.fn()} mutate={mutate} />);
  await user.click(screen.getByRole('button', { name: /^编\s*辑$/ }));
  await user.clear(screen.getByLabelText('服务名称'));
  await user.clear(screen.getByLabelText('模型 ID'));
  await user.type(screen.getByLabelText('模型 ID'), 'draft-model');
  await user.click(screen.getByLabelText('API 协议'));
  await user.click(screen.getByText('openai-responses', { selector: '.ant-select-item-option-content' }));
  await user.click(screen.getByRole('button', { name: '测试模型' }));
  expect(await screen.findByText(/连接成功/)).toBeVisible();
  expect(request).toHaveBeenCalledWith('test_provider', { provider: { id: 'glm', baseUrl: 'https://example.test/v1', api: 'openai-responses', model: 'draft-model' } });
  expect(screen.getByText(/少量.*费用/)).toBeVisible();
  expect(screen.getByText(/不.*工具/)).toBeVisible();
  expect(mutate).not.toHaveBeenCalled();
});

it('validates the address for listing and additionally requires a model for testing', async () => {
  vi.mocked(request).mockResolvedValue(success);
  const user = userEvent.setup();
  render(<Settings providers={[]} onClose={vi.fn()} mutate={vi.fn()} />);
  await user.type(screen.getByLabelText('服务地址'), 'invalid');
  await user.click(screen.getByRole('button', { name: '获取模型列表' }));
  expect(await screen.findByText('请输入完整的服务 URL')).toBeVisible();
  expect(request).not.toHaveBeenCalled();
  await user.clear(screen.getByLabelText('服务地址'));
  await draft(user);
  await user.click(screen.getByRole('button', { name: '测试模型' }));
  expect(request).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText('模型 ID'), 'valid-model');
  await user.click(screen.getByRole('button', { name: '测试模型' }));
  expect(await screen.findByText(/连接成功/)).toBeVisible();
});

it.each(['服务地址', '模型 ID', 'API 密钥', 'API 协议', '编辑', '取消编辑', '关闭', '卸载'])('ignores pending replies after %s changes', async change => {
  const pending = deferred();
  vi.mocked(request).mockReturnValueOnce(pending.promise).mockResolvedValue(success);
  const onClose = vi.fn();
  const user = userEvent.setup();
  const view = render(<Settings providers={[provider]} onClose={onClose} mutate={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: /^编\s*辑$/ }));
  await user.click(screen.getByRole('button', { name: '测试模型' }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button', { name: '测试模型' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '获取模型列表' })).toBeDisabled();
  if (change === '编辑') await user.click(screen.getByRole('button', { name: /^编\s*辑$/ }));
  else if (change === '取消编辑') await user.click(screen.getByRole('button', { name: '取消编辑' }));
  else if (change === '关闭') await user.click(screen.getByRole('button', { name: 'Close' }));
  else if (change === '卸载') view.unmount();
  else if (change === 'API 协议') {
    await user.click(screen.getByLabelText('API 协议'));
    await user.click(screen.getByText('openai-responses', { selector: '.ant-select-item-option-content' }));
  } else await user.type(screen.getByLabelText(change), 'x');
  if (!['关闭', '卸载', '取消编辑'].includes(change)) {
    await user.click(screen.getByRole('button', { name: '测试模型' }));
    expect(await screen.findByText(/连接成功/)).toBeVisible();
  }
  await act(async () => pending.resolve({ ...success, message: '过期结果' }));
  expect(screen.queryByText(/过期结果/)).not.toBeInTheDocument();
  if (change === '关闭') expect(onClose).toHaveBeenCalledOnce();
});

it('renders safe diagnostic failures with status and elapsed time, not raw bridge errors', async () => {
  vi.mocked(request).mockResolvedValueOnce({ ok: false, code: 'auth_error', message: '认证失败，请检查密钥', status: 401, elapsedMs: 17 })
    .mockRejectedValueOnce(new Error('raw-secret response body'));
  const user = userEvent.setup();
  render(<Settings providers={[provider]} onClose={vi.fn()} mutate={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: /^编\s*辑$/ }));
  await user.click(screen.getByRole('button', { name: '测试模型' }));
  expect(await screen.findByText(/认证失败，请检查密钥/)).toBeVisible();
  expect(screen.getByText(/401/)).toBeVisible();
  expect(screen.getByText(/17 ms/)).toBeVisible();
  await user.click(screen.getByRole('button', { name: '测试模型' }));
  expect(await screen.findByText(/诊断请求失败/)).toBeVisible();
  expect(screen.queryByText(/raw-secret/)).not.toBeInTheDocument();
});

it('clears fetched models and ignores a stale model list after a key change', async () => {
  const pending = deferred();
  vi.mocked(request).mockResolvedValueOnce({ ...success, models: ['old-model'] }).mockReturnValueOnce(pending.promise);
  const user = userEvent.setup();
  render(<Settings providers={[provider]} onClose={vi.fn()} mutate={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: /^编\s*辑$/ }));
  await user.click(screen.getByRole('button', { name: '获取模型列表' }));
  expect(await screen.findByText(/连接成功/)).toBeVisible();
  await user.click(screen.getByLabelText('API 密钥'));
  await user.paste('replacement-key');
  expect(screen.queryByText(/连接成功/)).not.toBeInTheDocument();
  await user.click(screen.getByLabelText('模型 ID'));
  expect(screen.queryByText('old-model')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '获取模型列表' }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  await user.type(screen.getByLabelText('API 密钥'), 'x');
  await act(async () => pending.resolve({ ...success, message: '过期列表', models: ['stale-model'] } as typeof success));
  await user.click(screen.getByLabelText('模型 ID'));
  expect(screen.queryByText('stale-model')).not.toBeInTheDocument();
  expect(screen.queryByText(/过期列表/)).not.toBeInTheDocument();
});

it('omits an empty API key and preserves verified pricing when editing an existing service', async () => {
  const mutate = vi.fn().mockResolvedValue(true);
  const user = userEvent.setup();
  const pricing = { version: '2026-11', inputPerMillion: 1, outputPerMillion: 2, cacheReadPerMillion: 0.5 };
  render(<Settings providers={[{ id: 'glm', name: '自定义 GLM', baseUrl: 'https://example.test/v1', model: 'user-model', api: 'openai-completions', hasKey: true, pricing }]} onClose={vi.fn()} mutate={mutate} />);
  await user.click(screen.getByRole('button', { name: /^编\s*辑$/ }));
  expect(screen.getByLabelText('API 密钥')).toHaveValue('');
  await user.click(screen.getByText('可选：本地费用估算价格'));
  expect(screen.getByLabelText('价格版本')).toHaveValue('2026-11');
  expect(screen.getByLabelText('缓存读取价格')).toHaveValue('0.5');
  await user.click(screen.getByRole('button', { name: '保存服务' }));
  await waitFor(() => expect(mutate).toHaveBeenCalledWith('save_provider', { provider: { id: 'glm', name: '自定义 GLM', baseUrl: 'https://example.test/v1', model: 'user-model', api: 'openai-completions', pricing } }));
});
