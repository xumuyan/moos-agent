import type { AgentEvent } from '../types';

const SECRET = /api[-_]?key|authorization|password|secret|token/i;
function safe(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safe);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !SECRET.test(key)).map(([key, nested]) => [key, safe(nested)]));
  return value;
}

export default function ToolCard({ event }: { event: AgentEvent }) {
  const name = String(event.payload.name ?? event.payload.toolName ?? event.type);
  const summary = safe(event.payload);
  return <details className="tool-row tool-card" open>
    <summary>{name}<span className="muted">{event.type}</span></summary>
    <pre>{JSON.stringify(summary, null, 2)}</pre>
  </details>;
}
