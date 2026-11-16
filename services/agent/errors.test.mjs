import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTaskError, TaskFailure } from './errors.mjs';

const matrix = [
  ['401 invalid api key SECRET', 'auth'], ['insufficient_quota SECRET', 'quota'], ['HTTP 429 SECRET', 'rate_limit'],
  ['unsupported image input SECRET', 'model_capability'], ['maximum context length SECRET', 'context_limit'],
  ['Context overflow recovery failed after one compact-and-retry attempt. SECRET', 'context_limit'],
  ['Truncated response recovery failed after one compact-and-retry attempt. SECRET', 'context_limit'],
  ['上下文已满 SECRET', 'context_limit'], ['context overflow detected SECRET', 'context_limit'],
  ['fetch failed ECONNRESET SECRET', 'network'], ['tool execution failed SECRET', 'tool_error'],
  ['operation not permitted SECRET', 'permission'], ['request timed out SECRET', 'timeout'],
  ['runtime process exited SECRET', 'runtime_exit'], ['invalid response protocol SECRET', 'protocol'],
  ['OpenAI Responses stream ended before a terminal response event SECRET', 'network'],
  ['response stream closed mid-turn SECRET', 'network'],
];

test('task failures use stable safe codes without returning upstream text', () => {
  for (const [raw, code] of matrix) {
    const result = classifyTaskError(new Error(raw));
    assert.equal(result.code, code, raw);
    assert(!result.message.includes('SECRET'));
    assert(!result.message.includes(raw));
  }
  assert.equal(classifyTaskError(new TaskFailure('timeout')).code, 'timeout');
  assert.equal(classifyTaskError(new Error('unmatched SECRET')).code, 'internal');
});

test('verification rejection and incomplete verdict get distinct truthful codes', () => {
  const rejected = classifyTaskError(new TaskFailure('verification_rejected'));
  assert.equal(rejected.code, 'verification_rejected');
  assert.ok(rejected.message.includes('独立验证未通过'));
  const incomplete = classifyTaskError(new TaskFailure('verification_incomplete'));
  assert.equal(incomplete.code, 'verification_incomplete');
  assert.ok(incomplete.message.includes('未提交验收结论'));
  assert.equal(classifyTaskError(new TaskFailure('tool_error')).message.includes('本地工具'), true);
  assert.throws(() => new TaskFailure('verification_rejected_extra'), /Invalid task failure code/);
});
