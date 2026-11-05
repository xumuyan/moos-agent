import test from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_TASK_TIMEOUTS, DEFAULT_TASK_TIMEOUT_MS, taskTimeout } from './task-policy.mjs';

test('task timeout is one of six bounded choices and defaults to two hours', () => {
  assert.deepEqual(ALLOWED_TASK_TIMEOUTS, [600000, 1800000, 3600000, 7200000, 21600000, 86400000]);
  assert.equal(DEFAULT_TASK_TIMEOUT_MS, 7200000);
  assert.equal(taskTimeout(undefined), 7200000);
  for (const value of ALLOWED_TASK_TIMEOUTS) assert.equal(taskTimeout(value), value);
  for (const value of [0, -1, 1, 599999, 600001, 86400001, Infinity, NaN, '7200000']) {
    assert.throws(() => taskTimeout(value), /task timeout/i);
  }
});
