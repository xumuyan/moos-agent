import { beforeEach, expect, it, vi } from 'vitest';
import { configure, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { request } from './api';
vi.mock('./api', () => ({ request: vi.fn() }));
const bridge = vi.mocked(request);
const page = (before: string | number | null, hasMore = false, requiresScopedPage = false) => ({ total: 100, before, hasMore, requiresScopedPage, truncatedRows: [] });
const message = (id: string, content: string) => ({ id, conversationId: 'c1', role: 'assistant', content });
const snapshot = (content = '最新回答') => ({
  projects: [{ id: 'p1', name: '项目', path: '/project' }],
  conversations: [{ id: 'c1', projectId: 'p1', title: '会话' }, { id: 'c2', projectId: 'p1', title: '另一会话' }],
  providers: [], messages: [message('m50', content)], tasks: [], events: [],
  history: { version: 1, pages: [{ conversationId: 'c1', messages: page('m50', true), tasks: page(null), events: page(70, true) }] },
});
// Ant Design portals/layout are slower when the full suite runs in parallel.
configure({ asyncUtilTimeout: 5000 });
beforeEach(() => bridge.mockReset());

it('replaces older pages with independent cursors and keeps polling recent state without overwriting history', async () => {
  const latest = snapshot();
  bridge.mockImplementation(async (_method, params = {}) => {
    if (!params.conversationId) return structuredClone(latest);
    if (!params.before) return structuredClone(latest);
    expect(params).toEqual({ conversationId: 'c1', before: { messages: 'm50', events: 70 } });
    return { ...snapshot(), messages: [message('m1', '更早回答')], history: { version: 1, pages: [{ conversationId: 'c1', messages: page('m1'), tasks: page(null), events: page(1) }] } };
  });
  const user = userEvent.setup(); render(<App />);
  await screen.findByText('最新回答');
  await user.click(screen.getByRole('button', { name: '查看更早记录' }));
  await screen.findByText('更早回答');
  expect(screen.queryByText('最新回答')).not.toBeInTheDocument();
  const calls = bridge.mock.calls.length;
  latest.messages = [message('m60', '新到回答')];
  await waitFor(() => expect(bridge.mock.calls.length).toBeGreaterThan(calls), { timeout: 2500 });
  expect(screen.getByText('更早回答')).toBeInTheDocument();
  expect(screen.queryByText('新到回答')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '返回最新' }));
  await screen.findByText('新到回答');
  expect(screen.queryByText('更早回答')).not.toBeInTheDocument();
});

it('keeps an exhausted collection at its cursor while another collection pages further', async () => {
  bridge.mockImplementation(async (_method, params = {}) => {
    if (!params.before) return snapshot();
    const cursor = params.before as Record<string, unknown>;
    if (cursor.messages === 'm50') return { ...snapshot(), messages: [message('m1', '历史第一页')], history: { version: 1, pages: [{ conversationId: 'c1', messages: page('m1'), tasks: page('t1'), events: page(20, true) }] } };
    expect(params.before).toEqual({ messages: 'm1', tasks: 't1', events: 20 });
    return { ...snapshot(), messages: [], history: { version: 1, pages: [{ conversationId: 'c1', messages: page('m1'), tasks: page('t1'), events: page(1) }] } };
  });
  const user = userEvent.setup(); render(<App />);
  await screen.findByText('最新回答');
  await user.click(screen.getByRole('button', { name: '查看更早记录' }));
  await screen.findByText('历史第一页');
  await user.click(screen.getByRole('button', { name: '查看更早记录' }));
  await waitFor(() => expect(screen.queryByText('历史第一页')).not.toBeInTheDocument());
  expect(screen.queryByText('最新回答')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '查看更早记录' })).toBeDisabled();
});

it('loads a selected conversation scoped when global budget omitted its rows', async () => {
  bridge.mockImplementation(async (_method, params = {}) => params.conversationId
    ? snapshot('范围内回答')
    : { ...snapshot(), messages: [], history: { version: 1, pages: [{ conversationId: 'c1', messages: page(null, true, true), tasks: page(null), events: page(null) }] } });
  render(<App />);
  expect(await screen.findByText('范围内回答')).toBeInTheDocument();
  expect(bridge).toHaveBeenCalledWith('snapshot', { conversationId: 'c1' });
});

it('offers truncated rows from all collections and reconstructs split JSON only on explicit request', async () => {
  const latest = snapshot();
  latest.messages = [message('m50', '')];
  const metadata = latest.history.pages[0];
  Object.assign(metadata.messages, { truncatedRows: [{ id: 'm50', originalBytes: 90000, historyRow: { collection: 'messages', id: 'm50', offset: 0 } }] });
  Object.assign(metadata.tasks, { truncatedRows: [{ id: 't1', originalBytes: 90000 }] });
  Object.assign(metadata.events, { truncatedRows: [{ id: 70, originalBytes: 90000 }] });
  const json = JSON.stringify(message('m50', '<img src=x>完整回答'));
  bridge.mockImplementation(async (_method, params = {}) => {
    if (!params.historyRow) return latest;
    const cursor = params.historyRow as { collection: string; id: string; offset: number };
    const offset = cursor.offset;
    return { ...latest, history: { version: 1, pages: [], row: { ...cursor, revision: 'stable-version', json: offset === 0 ? json.slice(0, 32) : json.slice(32), nextOffset: offset === 0 ? 32 : null, totalLength: json.length } } };
  });
  const user = userEvent.setup(); render(<App />);
  const buttons = await screen.findAllByRole('button', { name: /查看完整记录/ });
  expect(buttons).toHaveLength(3);
  expect(bridge.mock.calls.some(([, p]) => p?.historyRow)).toBe(false);
  await user.click(buttons[0]);
  expect(await screen.findByLabelText('完整记录内容')).toHaveTextContent('<img src=x>完整回答');
  expect(document.querySelector('img[src="x"]')).toBeNull();
  expect(bridge).toHaveBeenCalledWith('snapshot', { conversationId: 'c1', historyRow: { collection: 'messages', id: 'm50', offset: 32, revision: 'stable-version' } });
});

it('rejects a changed revision without displaying a mixed record', async () => {
  const latest = snapshot();
  Object.assign(latest.history.pages[0].messages, { truncatedRows: [{ id: 'm50', originalBytes: 90000 }] });
  const json = JSON.stringify(message('m50', '不能拼接不同版本'));
  bridge.mockImplementation(async (_method, params = {}) => {
    if (!params.historyRow) return latest;
    const cursor = params.historyRow as { offset: number };
    const offset = cursor.offset;
    return { ...latest, history: { version: 1, pages: [], row: { collection: 'messages', id: 'm50', offset, revision: offset === 0 ? 'first' : 'changed', json: offset === 0 ? json.slice(0, 32) : json.slice(32), nextOffset: offset === 0 ? 32 : null, totalLength: json.length } } };
  });
  const user = userEvent.setup(); render(<App />);
  await user.click(await screen.findByRole('button', { name: '查看完整记录' }));
  await screen.findByText('完整记录版本已变化，请关闭后重试');
  expect(screen.queryByLabelText('完整记录内容')).not.toBeInTheDocument();
});

it('shows events whose task lies on a different independent page', async () => {
  bridge.mockResolvedValue({ ...snapshot(), messages: [], events: [{ id: 70, taskId: 'outside-page', conversationId: 'c1', projectId: 'p1', type: 'tool_end', payload: { name: '独立事件工具', result: '真实工具结果' } }] });
  render(<App />);
  expect(await screen.findByText(/独立事件工具/, { selector: 'summary' })).toBeInTheDocument();
  expect(screen.getByText(/真实工具结果/)).toBeInTheDocument();
});

it('reports invalid chunks instead of presenting partial JSON as a complete record', async () => {
  const latest = snapshot();
  Object.assign(latest.history.pages[0].messages, { truncatedRows: [{ id: 'm50', originalBytes: 90000 }] });
  bridge.mockImplementation(async (_method, params = {}) => !params.historyRow ? latest : {
    ...latest, history: { version: 1, pages: [], row: { collection: 'messages', id: 'm50', offset: 0, revision: 'stable', json: '{', nextOffset: null, totalLength: 100 } },
  });
  const user = userEvent.setup(); render(<App />);
  await user.click(await screen.findByRole('button', { name: '查看完整记录' }));
  await screen.findByText('完整记录尚未传输完成，请重试');
  expect(screen.queryByLabelText('完整记录内容')).not.toBeInTheDocument();
});

it('cancels a chunk viewer without fetching or displaying subsequent chunks', async () => {
  const latest = snapshot();
  Object.assign(latest.history.pages[0].messages, { truncatedRows: [{ id: 'm50', originalBytes: 90000 }] });
  let finish: (value: unknown) => void = () => {};
  bridge.mockImplementation(async (_method, params = {}) => !params.historyRow ? latest : new Promise(resolve => { finish = resolve; }));
  const user = userEvent.setup(); render(<App />);
  await user.click(await screen.findByRole('button', { name: '查看完整记录' }));
  await user.click(await screen.findByRole('button', { name: '取消加载' }));
  finish({ ...latest, history: { version: 1, pages: [], row: { collection: 'messages', id: 'm50', offset: 0, json: '{', nextOffset: 1, totalLength: 100 } } });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(bridge.mock.calls.filter(([, p]) => p?.historyRow)).toHaveLength(1);
});

it('shows page errors without losing the current page and ignores a late response after selection changes', async () => {
  let resolvePage: (value: unknown) => void = () => {};
  let fail = true;
  bridge.mockImplementation(async (_method, params = {}) => {
    if (!params.before) return snapshot();
    if (fail) throw new Error('分页失败');
    return new Promise(resolve => { resolvePage = resolve; });
  });
  const user = userEvent.setup(); render(<App />);
  await screen.findByText('最新回答');
  await user.click(screen.getByRole('button', { name: '查看更早记录' }));
  await screen.findByText('分页失败');
  expect(screen.getByText('最新回答')).toBeInTheDocument();
  fail = false;
  await user.click(screen.getByRole('button', { name: '查看更早记录' }));
  await user.click(screen.getByRole('button', { name: '另一会话' }));
  resolvePage({ ...snapshot(), messages: [message('old', '不应显示')] });
  await waitFor(() => expect(screen.queryByText('最新回答')).not.toBeInTheDocument());
  expect(screen.queryByText('不应显示')).not.toBeInTheDocument();
});
