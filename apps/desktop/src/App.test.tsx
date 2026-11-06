import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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
    if (method === 'pick_directory') return '/work/project';
    if (method === 'add_project') { state.projects.push(project); return project; }
    if (method === 'create_conversation') { state.conversations.push(conversation); return conversation; }
    if (method === 'submit') { state.tasks.push({ id: 't1', projectId: 'p1', conversationId: params.conversationId, message: params.message, status: 'running' }); return { id: 't1' }; }
    if (method === 'cancel') { state.tasks = []; return {}; }
    return {};
  });
});
describe('desktop assistant', () => {
  it('removes the right inspector and keeps each turn’s confirmed files in the conversation', async () => {
    state.projects = [project]; state.conversations = [conversation]; state.providers = [provider];
    state.tasks = ['new', 'old'].map(id => ({ id, projectId: 'p1', conversationId: 'c1', message: id, status: 'succeeded' }));
    state.events = ['new', 'old'].flatMap(id => [
      { id: `${id}-start`, taskId: id, projectId: 'p1', conversationId: 'c1', type: 'tool_start', payload: { toolCallId: id, toolName: 'edit', args: { path: `${id}.ts` } } },
      { id: `${id}-end`, taskId: id, projectId: 'p1', conversationId: 'c1', type: 'tool_end', payload: { toolCallId: id, toolName: 'edit', isError: false } },
    ]);
    render(<App />);
    await screen.findByText('new.ts');
    expect(screen.queryByRole('complementary', { name: '上下文面板' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '收起上下文面板' })).not.toBeInTheDocument();
    const records = screen.getAllByRole('region', { name: '任务执行记录' });
    expect(within(records[0]).getByRole('region', { name: '修改文件汇总' })).toHaveTextContent('new.ts');
    expect(within(records[0]).queryByText('old.ts')).not.toBeInTheDocument();
    expect(within(records[1]).getByRole('region', { name: '修改文件汇总' })).toHaveTextContent('old.ts');
  });
  it('opens the directory picker and adds its selected path without a text field', async () => {
    const user = userEvent.setup(); render(<App />);
    await screen.findByText('添加项目，开始开发');
    await user.click(screen.getByRole('button', { name: '添加项目' }));
    await waitFor(() => expect(bridge).toHaveBeenCalledWith('pick_directory'));
    await screen.findByRole('button', { name: '工作项目' });
    expect(bridge).toHaveBeenCalledWith('add_project', { path: '/work/project' });
    expect(screen.queryByRole('textbox', { name: '项目目录' })).not.toBeInTheDocument();
  });
  it('selects the added project only when a refreshed snapshot contains it', async () => {
    state.projects = [{ id: 'old', name: '原有项目', path: '/old' }];
    let added = false;
    bridge.mockImplementation(async method => {
      if (method === 'pick_directory') return '/work/project';
      if (method === 'add_project') { added = true; return project; }
      return structuredClone(state);
    });
    const user = userEvent.setup(); render(<App />);
    await user.click(await screen.findByRole('button', { name: '添加项目' }));
    await waitFor(() => expect(added).toBe(true));
    state.projects.push(project);
    await screen.findByRole('button', { name: '工作项目' }, { timeout: 2500 });
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('工作项目'), { timeout: 2500 });
  });
  it('does not add a project when directory selection is cancelled', async () => {
    bridge.mockImplementation(async method => method === 'pick_directory' ? null : structuredClone(state));
    const user = userEvent.setup(); render(<App />);
    await user.click(await screen.findByRole('button', { name: '添加项目' }));
    await waitFor(() => expect(bridge).toHaveBeenCalledWith('pick_directory'));
    expect(bridge.mock.calls.some(([method]) => method === 'add_project')).toBe(false);
    expect(screen.getByRole('button', { name: '添加项目' })).toBeEnabled();
  });
  it('shows directory picker failures and allows retry', async () => {
    bridge.mockImplementation(async method => { if (method === 'pick_directory') throw new Error('无法打开目录选择器'); return structuredClone(state); });
    const user = userEvent.setup(); render(<App />);
    await user.click(await screen.findByRole('button', { name: '添加项目' }));
    await screen.findByText('无法打开目录选择器');
    expect(screen.getByRole('button', { name: '添加项目' })).toBeEnabled();
    expect(bridge.mock.calls.some(([method]) => method === 'add_project')).toBe(false);
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
      const process1 = within(records[0]).getByRole('region', { name: '实际工具轨迹' });
      const process2 = within(records[1]).getByRole('region', { name: '实际工具轨迹' });
      before(prompt1, process1); before(process1, answer1); before(answer1, prompt2); before(prompt2, process2); before(records[0], records[1]);
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
    state.messages = [{ id: 'a1', role: 'assistant', content: '完成\n\n<img src=x onerror=alert(1)>', conversationId: 'c1', taskId: 't1' }];
    state.events = [{ id: 'e1', type: 'text_delta', taskId: 't1', projectId: 'p1', conversationId: 'c1', payload: { delta: '完成\n\n<img src=x onerror=alert(1)>' } }];
    render(<App />);
    expect(await screen.findAllByText('完成')).toHaveLength(1);
    expect(screen.queryByText('<img src=x onerror=alert(1)>')).not.toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });
});
