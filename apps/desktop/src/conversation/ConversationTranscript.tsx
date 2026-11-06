import { Bubble } from '@ant-design/x';
import { CodeOutlined } from '@ant-design/icons';
import { isActive, type AgentEvent, type Message, type Task } from '../types';
import { SlotHost } from '../plugins/slots';
import MessageContent from './MessageContent';
import TurnProcess from './TurnProcess';
import { TaskFiles } from './TaskTrajectory';
import { transcript } from './transcript';

function MessageRow({ message }: { message: Message }) {
  return <div className={`message message-${message.role}`} data-scroll-anchor>
    {message.role === 'assistant' ? <MessageContent text={message.content} /> : <Bubble placement={message.role === 'user' ? 'end' : 'start'} content={<span className="plain-text">{message.content}</span>} />}
    <SlotHost slot="conversation.message" context={{ messageId: message.id, role: message.role }} />
  </div>;
}

export default function ConversationTranscript({ messages, tasks, events, onStop }: {
  messages: Message[]; tasks: Task[]; events: AgentEvent[]; onStop: (id: string) => void;
}) {
  return <div className="thread grouped-transcript">{transcript(messages, tasks).map(item => {
    if (item.kind === 'message') return <MessageRow message={item.message} key={`message:${item.message.id}`} />;
    const { task, messages: turnMessages } = item;
    const turnEvents = events.filter(event => event.taskId === task.id && event.projectId === task.projectId && event.conversationId === task.conversationId);
    const prompts = turnMessages.filter(message => message.role === 'user');
    const replies = turnMessages.filter(message => message.role !== 'user');
    const saved = replies.some(message => message.role === 'assistant');
    const stream = saved ? '' : turnEvents.filter(event => event.type === 'text_delta').map(event => typeof event.payload.delta === 'string' ? event.payload.delta : '').join('');
    const running = isActive(task);
    return <section className="conversation-turn" key={task.id} aria-label="任务执行记录">
      <div className="turn-prompts">{prompts.length ? prompts.map(message => <MessageRow key={message.id} message={message} />) : <div className="message message-user"><Bubble placement="end" content={<span className="plain-text">{task.message}</span>} /></div>}</div>
      <div className="assistant-turn">
        <header className="response-heading" data-scroll-anchor><span className="response-avatar" aria-hidden="true"><CodeOutlined /></span><strong>Moos</strong></header>
        <div className="response-content">
          <TurnProcess task={task} events={turnEvents} onStop={() => onStop(task.id)} />
          <SlotHost slot="conversation.tool" context={{ taskId: task.id, events: turnEvents.filter(event => ['tool_start', 'tool_end', 'tool_update', 'task_state'].includes(event.type)) }} />
          {stream && <MessageContent text={stream} />}
          {replies.map(message => <MessageRow key={message.id} message={message} />)}
          {!stream && !saved && <p className="turn-empty-reply">{running ? '正在处理你的任务…' : task.status === 'failed' ? '本轮未完成，当前记录中没有最终回复。' : task.status === 'cancelled' ? '任务已停止，当前记录中没有最终回复。' : '当前记录中没有最终回复。'}</p>}
          <TaskFiles events={turnEvents} finished={!running} />
          {running && task.heartbeatAt && <p className="turn-heartbeat">阶段：{task.stage ?? 'running'} · 最近心跳：{new Date(task.heartbeatAt).toLocaleTimeString()}</p>}
        </div>
      </div>
    </section>;
  })}</div>;
}
