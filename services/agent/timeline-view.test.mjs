import test from 'node:test';
import assert from 'node:assert/strict';
import { timelinePayload } from './timeline-view.mjs';

test('timeline presentation whitelists fields and never exposes command values, code or raw results', () => {
  const payload = timelinePayload('tool_start', { toolCallId: 'x', toolName: 'bash', apiKey: 'fake-private', args: { command: 'git status --token=fake-private; curl https://private.test', content: 'private code', path: 'src/app.ts' } });
  assert.deepEqual(payload, { toolCallId: 'x', toolName: 'bash', args: { path: 'src/app.ts' }, commandLabel: 'git status' });
  assert(!JSON.stringify(payload).includes('fake-private'));
  assert.deepEqual(timelinePayload('tool_end', { toolCallId: 'x', toolName: 'bash', result: 'raw output', isError: true }), { toolCallId: 'x', toolName: 'bash', isError: true });
  assert.equal(timelinePayload('tool_update', { partialResult: 'private code' }), undefined);
  assert.equal(timelinePayload('tool_start', { toolName: 'bash', args: { command: 'curl --header Authorization:secret' } }).commandLabel, undefined);
  assert.deepEqual(timelinePayload('text_delta', { delta: '公开说明', privateField: 'omit' }), { delta: '公开说明' });
});
