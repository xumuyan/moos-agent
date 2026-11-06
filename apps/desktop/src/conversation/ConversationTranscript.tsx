import { Bubble } from '@ant-design/x';
import { isActive, type AgentEvent, type Message, type Task } from '../types';
import { SlotHost } from '../plugins/slots';
import MessageContent from './MessageContent';
import TurnTimeline from './TurnTimeline';
import { transcript } from './transcript';

function MessageRow({ message }: { message: Message }) {
  return <div className={`message message-${message.role}`} data-scroll-anchor>
    {message.role === 'assistant' ? <MessageContent text={message.content} /> : <Bubble placement={message.role === 'user' ? 'end' : 'start'} content={<span className="plain-text">{message.content}</span>} />}
    <SlotHost slot="conversation.message" context={{ messageId: message.id, role: message.role }} />
  </div>;
}

export default function ConversationTranscript({ messages, tasks, events, onStop, loadProcess = true }: {
  messages: Message[]; tasks: Task[]; events: AgentEvent[]; onStop: (id: string) => void; loadProcess?: boolean;
}) {
  return <div className="thread grouped-transcript">{transcript(messages, tasks).map(item => {
    if (item.kind === 'message') return <MessageRow message={item.message} key={`message:${item.message.id}`} />;
    const { task, messages: turnMessages } = item;
    const turnEvents = events.filter(event => event.taskId === task.id && event.projectId === task.projectId && event.conversationId === task.conversationId);
    const prompts = turnMessages.filter(message => message.role === 'user');
    const replies = turnMessages.filter(message => message.role !== 'user');
    const savedReplies = replies.filter(message => message.role === 'assistant');
    const running = isActive(task);
    const compact = !running && ['failed', 'cancelled', 'interrupted'].includes(task.status) && savedReplies.length === 0;
    return <section className={`conversation-turn ${compact ? 'is-incomplete' : ''}`} key={task.id} aria-label="任务执行记录">
      <div className="turn-prompts">{prompts.length ? prompts.map(message => <MessageRow key={message.id} message={message} />) : <div className="message message-user"><Bubble placement="end" content={<span className="plain-text">{task.message}</span>} /></div>}</div>
      <div className="assistant-turn">
        <div className="response-content">
          <TurnTimeline task={task} events={turnEvents} savedText={savedReplies.length ? savedReplies.map(message => message.content).join('') : undefined} onStop={() => onStop(task.id)} timelineMode={loadProcess ? tasks.slice(0, 8).some(row => row.id === task.id) ? 'auto' : 'manual' : 'off'}
            messageSlots={savedReplies.map(message => <SlotHost key={message.id} slot="conversation.message" context={{ messageId: message.id, role: message.role }} />)} />
          <SlotHost slot="conversation.tool" context={{ taskId: task.id, events: turnEvents.filter(event => ['tool_start', 'tool_end', 'tool_update', 'task_state'].includes(event.type)) }} />
          {replies.filter(message => message.role !== 'assistant').map(message => <MessageRow key={message.id} message={message} />)}
          {running && task.heartbeatAt && <p className="turn-heartbeat">阶段：{task.stage ?? 'running'} · 最近心跳：{new Date(task.heartbeatAt).toLocaleTimeString()}</p>}
        </div>
      </div>
    </section>;
  })}</div>;
}
