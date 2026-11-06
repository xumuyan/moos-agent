import type { AgentEvent } from '../types';

export type TimelineStep = { kind: 'text'; id: string; text: string } | { kind: 'tools'; id: string; events: AgentEvent[] };

export function timelineSteps(events: AgentEvent[]): TimelineStep[] {
  const steps: TimelineStep[] = [];
  const calls = new Map<string, Extract<TimelineStep, { kind: 'tools' }>>();
  for (const event of events) {
    const previous = steps.at(-1);
    if (event.type === 'text_delta' && typeof event.payload.delta === 'string' && event.payload.delta) {
      if (previous?.kind === 'text') previous.text += event.payload.delta;
      else steps.push({ kind: 'text', id: event.id, text: event.payload.delta });
    } else if (event.type === 'tool_start' || event.type === 'tool_end') {
      const call = String(event.payload.toolCallId ?? event.id);
      let block = calls.get(call);
      if (!block) {
        block = previous?.kind === 'tools' ? previous : { kind: 'tools', id: event.id, events: [] };
        if (block !== previous) steps.push(block);
        calls.set(call, block);
      }
      block.events.push(event);
    }
  }
  return steps;
}

export function projectTimeline(events: AgentEvent[], savedText: string | undefined, finalize: boolean) {
  const steps = timelineSteps(events);
  const eventText = steps.filter(step => step.kind === 'text').map(step => step.text).join('');
  // Independent event paging may omit text. The saved reply wins rather than duplicating a partial reconstruction.
  if (savedText !== undefined && savedText.trim() !== eventText.trim()) {
    const tools = events.filter(event => event.type === 'tool_start' || event.type === 'tool_end');
    return { progress: tools.length ? [{ kind: 'tools', id: tools[0].id, events: tools } as TimelineStep] : [], reply: savedText };
  }
  const last = steps.at(-1);
  if (finalize && last?.kind === 'text') return { progress: steps.slice(0, -1), reply: last.text };
  return { progress: steps, reply: undefined };
}
