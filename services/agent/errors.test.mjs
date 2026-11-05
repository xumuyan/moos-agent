import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTaskError, TaskFailure } from './errors.mjs';

const matrix = [
  ['401 invalid api key SECRET', 'auth'], ['insufficient_quota SECRET', 'quota'], ['HTTP 429 SECRET', 'rate_limit'],
  ['unsupported image input SECRET', 'model_capability'], ['maximum context length SECRET', 'context_limit'],
  ['fetch failed ECONNRESET SECRET', 'network'], ['tool execution failed SECRET', 'tool_error'],
  ['operation not permitted SECRET', 'permission'], ['request timed out SECRET', 'timeout'],
  ['runtime process exited SECRET', 'runtime_exit'], ['invalid response protocol SECRET', 'protocol'],
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
