import type { Message, Task } from '../types';

export type TranscriptItem = { kind: 'message'; message: Message } | { kind: 'turn'; task: Task; messages: Message[] };

/** Anchor a whole task to its first visible message, preserving message order across pages. */
export function transcript(messages: Message[], tasks: Task[]): TranscriptItem[] {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const emitted = new Set<string>();
  const result: TranscriptItem[] = [];
  for (const message of messages) {
    const task = message.taskId ? byId.get(message.taskId) : undefined;
    if (!task) { result.push({ kind: 'message', message }); continue; }
    if (emitted.has(task.id)) continue;
    emitted.add(task.id);
    result.push({ kind: 'turn', task, messages: messages.filter(row => row.taskId === task.id) });
  }
  for (const task of tasks) if (!emitted.has(task.id)) result.push({ kind: 'turn', task, messages: [] });
  return result;
}
