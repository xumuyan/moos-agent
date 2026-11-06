import { expect, it } from 'vitest';
import { transcript } from './transcript';
import type { Message, Task } from '../types';

const task = (id: string): Task => ({ id, projectId: 'p', conversationId: 'c', message: id, status: 'completed' });
const message = (id: string, taskId?: string): Message => ({ id, taskId, conversationId: 'c', role: id.startsWith('u') ? 'user' : 'assistant', content: id });
it('groups prompts and answers once using message order instead of newest-first task order', () => {
  const result = transcript([message('u1', '1'), message('a1', '1'), message('u2', '2'), message('a2', '2')], [task('2'), task('1')]);
  expect(result.map(item => item.kind === 'turn' ? item.task.id : '')).toEqual(['1', '2']);
  expect(result[0]).toMatchObject({ kind: 'turn', messages: [{ id: 'u1' }, { id: 'a1' }] });
});
it('preserves standalone history and tasks whose prompt is outside the loaded page', () => {
  const result = transcript([message('standalone'), message('a1', '1')], [task('1'), task('missing')]);
  expect(result.map(item => item.kind)).toEqual(['message', 'turn', 'turn']);
  expect(result[2]).toMatchObject({ task: { id: 'missing' }, messages: [] });
});
