import { Bubble } from '@ant-design/x';
import type { Message } from '../types';

export default function MessageList({ messages }: { messages: Message[] }) {
  return <>{messages.map(message => <div className={`message message-${message.role}`} key={message.id}>
    <div className="message-label">{message.role === 'user' ? '你' : 'Moos'}</div>
    <Bubble content={<span className="plain-text">{message.content}</span>} placement={message.role === 'user' ? 'end' : 'start'} />
  </div>)}</>;
}
