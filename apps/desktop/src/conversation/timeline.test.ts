import { expect, it } from 'vitest';
import { projectTimeline, timelineSteps } from './timeline';
import type { AgentEvent } from '../types';
const event = (id: string, type: string, payload: Record<string, unknown>): AgentEvent => ({ id, type, payload, taskId: 't', projectId: 'p', conversationId: 'c' });
const events = [event('1', 'text_delta', { delta: '我先检查。' }), event('2', 'tool_start', { toolCallId: 'w', toolName: 'edit' }), event('3', 'tool_end', { toolCallId: 'w', toolName: 'edit' }), event('4', 'text_delta', { delta: '已修复。' })];
it('preserves narration/tool/result chronology and separates the final answer without duplication', () => {
  expect(timelineSteps(events).map(step => step.kind)).toEqual(['text', 'tools', 'text']);
  const result = projectTimeline(events, '我先检查。已修复。', true);
  expect(result.progress.map(step => step.kind)).toEqual(['text', 'tools']);
  expect(result.reply).toBe('已修复。');
});
it('attaches late end events to their original call instead of repeating the operation', () => {
  const steps = timelineSteps([events[0], events[1], events[3], events[2]]);
  expect(steps.map(step => step.kind)).toEqual(['text', 'tools', 'text']);
  expect(steps[1]).toMatchObject({ kind: 'tools', events: [{ id: '2' }, { id: '3' }] });
});
it('uses the saved full reply when event paging cannot reconstruct it and keeps partial cancelled text as process', () => {
  const fallback = projectTimeline(events.slice(1), '我先检查。已修复。', true);
  expect(fallback.reply).toBe('我先检查。已修复。');
  expect(fallback.progress.map(step => step.kind)).toEqual(['tools']);
  const stopped = projectTimeline(events, undefined, false);
  expect(stopped.reply).toBeUndefined();
  expect(stopped.progress).toHaveLength(3);
});
