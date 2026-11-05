import type { AgentEvent } from '../types';
import ToolCard from './ToolCard';

export default function TaskTrajectory({ events }: { events: AgentEvent[] }) {
  if (!events.length) return null;
  return <section className="task-trajectory" aria-label="实际工具轨迹">
    {events.map(event => <ToolCard key={event.id} event={event} />)}
  </section>;
}
