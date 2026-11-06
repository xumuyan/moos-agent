import { expect, it } from 'vitest';
import { activities, changedFiles, withoutCodeBlocks } from './activity';
import type { AgentEvent } from '../types';

const events = [
  { id: '1', type: 'tool_start', payload: { toolCallId: 'a', toolName: 'edit', args: { path: 'src/a.ts', oldText: 'secret code' } } },
  { id: '2', type: 'tool_update', payload: { toolCallId: 'a', partialResult: 'raw output' } },
  { id: '3', type: 'tool_end', payload: { toolCallId: 'a', toolName: 'edit', isError: false } },
  { id: '4', type: 'tool_start', payload: { toolCallId: 'b', toolName: 'write', args: { path: 'bad.ts' } } },
  { id: '5', type: 'tool_end', payload: { toolCallId: 'b', toolName: 'write', isError: true } },
].map(event => ({ ...event, taskId: 't', projectId: 'p', conversationId: 'c' })) as AgentEvent[];
it('merges start/end and counts only confirmed successful file changes', () => {
  expect(activities(events)).toHaveLength(2);
  expect(changedFiles(events)).toEqual([{ path: 'src/a.ts', description: '局部修改' }]);
  expect(JSON.stringify(activities(events))).not.toMatch(/secret code|raw output/);
});
it('omits completed and still-streaming code blocks while retaining prose', () => {
  expect(withoutCodeBlocks('修改好了\n```ts\nconst secret = 1;\n```\n测试通过')).toBe('修改好了\n（代码内容已省略）\n测试通过');
  expect(withoutCodeBlocks('```js\npartial')).toBe('（代码内容已省略）');
});
