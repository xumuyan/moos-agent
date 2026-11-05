import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { request } from './api';
vi.mock('./api', () => ({ request: vi.fn() }));
const bridge = vi.mocked(request);
const project = { id: 'p1', name: '工作项目', path: '/work/project' };
const conversation = { id: 'c1', projectId: 'p1', title: '开发会话' };
const provider = { id: 'm1', name: '我的模型', baseUrl: 'https://example.test', model: 'custom', api: 'openai-completions', hasKey: true };
let state: Record<string, unknown[]>;
beforeEach(() => {
  state = { projects: [], conversations: [], messages: [], tasks: [], events: [], providers: [] };
  bridge.mockReset();
  bridge.mockImplementation(async (method, params = {}) => {
    if (method === 'snapshot') return structuredClone(state);
    if (method === 'add_project') { state.projects.push(project); return project; }
    if (method === 'create_conversation') { state.conversations.push(conversation); return conversation; }
    if (method === 'submit') { state.tasks.push({ id: 't1', projectId: 'p1', conversationId: params.conversationId, message: params.message, status: 'running' }); return { id: 't1' }; }
    if (method === 'cancel') { state.tasks = []; return {}; }
    return {};
  });
});
describe('desktop assistant', () => {
  it('offers only manual absolute-path entry even when the legacy Tauri global is present', async () => {
    vi.stubGlobal('__TAURI__', {});
    try {
      const user = userEvent.setup(); render(<App />);
      await screen.findByText('添加项目，开始开发');
      await user.click(screen.getByRole('button', { name: '添加项目' }));
      expect(screen.queryByText('选择目录…')).not.toBeInTheDocument();
      await user.type(screen.getByRole('textbox', { name: '项目目录' }), '/work/project');
      await user.click(screen.getByRole('button', { name: '添加目录' }));
      await waitFor(() => expect(bridge).toHaveBeenCalledWith('add_project', { path: '/work/project' }));
      expect(bridge.mock.calls.some(([method]) => method === 'pick_directory')).toBe(false);
    } finally { vi.unstubAllGlobals(); }
  });
  it('keeps each turn’s execution between its prompt and answer, including after streaming is saved', async () => {
    state.projects = [project]; state.conversations = [conversation]; state.providers = [provider];
    // Task snapshot order must not override the associated message order.
    state.tasks = [
      { id: 't2', projectId: 'p1', conversationId: 'c1', message: '第二轮问题', status: 'running' },
      { id: 't1', projectId: 'p1', conversationId: 'c1', message: '第一轮问题', status: 'completed' },
    ];
    state.messages = [
      { id: 'u1', role: 'user', content: '第一轮问题', conversationId: 'c1', taskId: 't1' },
      { id: 'a1', role: 'assistant', content: '第一轮回答', conversationId: 'c1', taskId: 't1' },
      { id: 'u2', role: 'user', content: '第二轮问题', conversationId: 'c1', taskId: 't2' },
    ];
    state.events = [
      { id: 'e1', type: 'tool_start', taskId: 't1', projectId: 'p1', conversationId: 'c1', payload: { name: 'first-tool' } },
      { id: 'e2', type: 'text_delta', taskId: 't1', projectId: 'p1', conversationId: 'c1', payload: { delta: '第一轮回答' } },
      { id: 'e3', type: 'tool_start', taskId: 't2', projectId: 'p1', conversationId: 'c1', payload: { name: 'second-tool' } },
      { id: 'e4', type: 'text_delta', taskId: 't2', projectId: 'p1', conversationId: 'c1', payload: { delta: '第二轮回答' } },
    ];
    render(<App />);
    await screen.findByText('第二轮回答');
    const assertOrder = () => {
      const prompt1 = screen.getByText('第一轮问题');
      const answer1 = screen.getByText('第一轮回答');
      const prompt2 = screen.getByText('第二轮问题');
      const answer2 = screen.getByText('第二轮回答');
      const records = screen.getAllByRole('region', { name: '任务执行记录' });
      const before = (a: Element, b: Element) => expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(records).toHaveLength(2);
      expect(records[0]).toHaveTextContent('first-tool');
      expect(records[1]).toHaveTextContent('second-tool');
      before(prompt1, records[0]); before(records[0], answer1); before(answer1, prompt2); before(prompt2, records[1]); before(records[0], records[1]);
      before(prompt2, answer2);
    };
    assertOrder();
    state.messages.push({ id: 'a2', role: 'assistant', content: '第二轮回答', conversationId: 'c1', taskId: 't2' });
    state.tasks = (state.tasks as Array<Record<string, unknown>>).map(t => ({ ...t, status: 'completed' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '停止此任务' })).not.toBeInTheDocument(), { timeout: 2500 });
    assertOrder();
    expect(screen.getAllByText('第一轮回答')).toHaveLength(1);
    expect(screen.getAllByText('第二轮回答')).toHaveLength(1);
  });
  it('disables sending without a project or configured model', async () => {
    render(<App />);
    expect(await screen.findByText('添加项目，开始开发')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '任务内容' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '发送任务' })).toBeDisabled();
  });
  it('keeps submission disabled when a project has no model', async () => {
    state.projects = [project]; state.conversations = [conversation];
    render(<App />);
    await screen.findByRole('button', { name: '工作项目' });
    expect(screen.getByRole('button', { name: '发送任务' })).toBeDisabled();
    expect(screen.getByText('请先在设置中配置模型服务')).toBeInTheDocument();
  });
  it('adds a project, creates a chat, submits and cancels through the bridge', async () => {
    state.providers = [provider];
    const user = userEvent.setup(); render(<App />);
    await screen.findByText('添加项目，开始开发');
    await user.click(screen.getByRole('button', { name: '添加项目' }));
    await user.type(screen.getByRole('textbox', { name: '项目目录' }), '/work/project');
    await user.click(screen.getByRole('button', { name: '添加目录' }));
    await screen.findByRole('button', { name: '工作项目' });
    await user.click(screen.getByRole('button', { name: '新建会话' }));
    await screen.findByRole('button', { name: /开发会话/ });
    await user.type(screen.getByRole('textbox', { name: '任务内容' }), '检查项目');
    await user.click(screen.getByRole('button', { name: '发送任务' }));
    await waitFor(() => expect(bridge).toHaveBeenCalledWith('submit', { conversationId: 'c1', message: '检查项目', providerId: 'm1' }));
    await user.click(await screen.findByRole('button', { name: '停止任务' }));
    await waitFor(() => expect(bridge).toHaveBeenCalledWith('cancel', { taskId: 't1' }));
    expect(bridge).toHaveBeenCalledWith('add_project', { path: '/work/project' });
  });
  it('shows streaming text and keeps background tasks running when switching projects', async () => {
    state.projects = [project, { id: 'p2', name: '另一个项目', path: '/work/other' }];
    state.conversations = [conversation]; state.providers = [provider];
    state.tasks = [{ id: 't1', projectId: 'p1', conversationId: 'c1', message: '检查', status: 'running' }];
    state.events = [{ id: 'e1', type: 'text_delta', taskId: 't1', projectId: 'p1', conversationId: 'c1', payload: { delta: '正在读取项目' } }];
    const user = userEvent.setup(); render(<App />);
    await screen.findByText('正在读取项目');
    await user.click(screen.getByRole('button', { name: '另一个项目' }));
    expect(screen.getByText('1 个后台任务')).toBeInTheDocument();
    expect(screen.queryByText('正在读取项目')).not.toBeInTheDocument();
    expect(bridge.mock.calls.some(([method]) => method === 'cancel')).toBe(false);
    await user.click(screen.getByRole('button', { name: '工作项目' }));
    expect(await screen.findByText('正在读取项目')).toBeInTheDocument();
  });
  it('renders streamed text once and never interprets HTML', async () => {
    state.projects = [project]; state.conversations = [conversation]; state.providers = [provider];
    state.tasks = [{ id: 't1', projectId: 'p1', conversationId: 'c1', message: 'test', status: 'completed' }];
    state.messages = [{ id: 'a1', role: 'assistant', content: '<img src=x onerror=alert(1)>', conversationId: 'c1', taskId: 't1' }];
    state.events = [{ id: 'e1', type: 'text_delta', taskId: 't1', projectId: 'p1', conversationId: 'c1', payload: { delta: '<img src=x onerror=alert(1)>' } }];
    render(<App />);
    expect(await screen.findAllByText('<img src=x onerror=alert(1)>')).toHaveLength(1);
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });
});
