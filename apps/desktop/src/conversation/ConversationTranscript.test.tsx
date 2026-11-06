import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import ConversationTranscript from './ConversationTranscript';
import type { AgentEvent, Message, Task } from '../types';
import { SlotHost } from '../plugins/slots';
vi.mock('../plugins/slots', () => ({ SlotHost: vi.fn(() => null) }));
const task: Task = { id: 't', projectId: 'p', conversationId: 'c', message: '调整会话', status: 'completed' };
const events: AgentEvent[] = [
  { id: '1', taskId: 't', projectId: 'p', conversationId: 'c', type: 'tool_start', payload: { toolCallId: 'w', toolName: 'write', args: { path: 'src/chat.tsx' } } },
  { id: '2', taskId: 't', projectId: 'p', conversationId: 'c', type: 'tool_end', payload: { toolCallId: 'w', toolName: 'write' } },
  { id: '3', taskId: 't', projectId: 'foreign', conversationId: 'c', type: 'tool_start', payload: { toolCallId: 'f', toolName: 'write', args: { path: 'foreign.ts' } } },
  { id: '4', taskId: 't', projectId: 'foreign', conversationId: 'c', type: 'tool_end', payload: { toolCallId: 'f', toolName: 'write' } },
];
it('puts process, answer and confirmed file summary in one response with files last', () => {
  const messages: Message[] = [
    { id: 'u', conversationId: 'c', taskId: 't', role: 'user', content: '调整会话' },
    { id: 'a', conversationId: 'c', taskId: 't', role: 'assistant', content: '会话已调整。' },
  ];
  render(<ConversationTranscript loadProcess={false} messages={messages} tasks={[task]} events={events} onStop={vi.fn()} />);
  const turn = screen.getByRole('region', { name: '任务执行记录' });
  const process = within(turn).getByRole('region', { name: '实际工具轨迹' });
  const answer = screen.getByText('会话已调整。');
  const files = within(turn).getByRole('region', { name: '修改文件汇总' });
  expect(process.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(answer.compareDocumentPosition(files) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByText('Moos')).not.toBeInTheDocument();
  expect(turn.querySelector('.response-heading, .response-avatar')).toBeNull();
  expect(files).toHaveTextContent('src/chat.tsx');
  expect(screen.queryByText('foreign.ts')).not.toBeInTheDocument();
  const slots = vi.mocked(SlotHost).mock.calls.map(([props]) => props);
  expect(slots).toContainEqual(expect.objectContaining({ slot: 'conversation.message', context: { messageId: 'a', role: 'assistant' } }));
  expect(slots).toContainEqual(expect.objectContaining({ slot: 'conversation.tool', context: expect.objectContaining({ taskId: 't', events: events.slice(0, 2) }) }));
});
it('keeps cancelled turns readable and routes stop to the correct task', async () => {
  const stop = vi.fn();
  const { rerender } = render(<ConversationTranscript loadProcess={false} messages={[]} tasks={[{ ...task, status: 'cancelled' }]} events={[]} onStop={stop} />);
  expect(screen.getByText('调整会话')).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('已停止');
  expect(screen.queryByText(/当前记录中没有最终回复/)).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: '修改文件汇总' })).not.toBeInTheDocument();
  expect(screen.queryByText('已完成')).not.toBeInTheDocument();
  rerender(<ConversationTranscript loadProcess={false} messages={[]} tasks={[{ ...task, status: 'running' }]} events={[]} onStop={stop} />);
  await userEvent.click(screen.getByRole('button', { name: '停止此任务' }));
  expect(stop).toHaveBeenCalledWith('t');
});
