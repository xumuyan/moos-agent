import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { checkedTaskMode, previousTaskMode, submissionMode } from './plugin/pi-submission.js';

test('versioned submission modes fail closed and legacy task snapshots remain ordinary', () => {
  assert.equal(submissionMode(undefined), 'ordinary');
  assert.equal(submissionMode(randomUUID()), 'ordinary');
  for (const mode of ['ordinary', 'team']) {
    assert.equal(submissionMode(`moos-pi-mode:v1:${mode}:${randomUUID()}`), mode);
    assert.equal(checkedTaskMode(mode), mode);
  }
  for (const invalid of ['moos-pi-mode:v2:team:' + randomUUID(), 'moos-pi-mode:v1:team:' + '-'.repeat(36), 'moos-pi-mode:v1:team:' + randomUUID() + '\n']) {
    assert.throws(() => submissionMode(invalid), /Unsupported/);
  }
  for (const snapshot of [null, false, 0, { version: 1, mode: undefined }, { version: 2, mode: 'team' }, { version: 1 }, { version: 1, mode: 'wrong' }, { version: 1, mode: null }]) {
    assert.throws(() => previousTaskMode({ lastTaskEvent: () => snapshot }, 'id'), /Unsupported/);
  }
  assert.equal(previousTaskMode({ lastTaskEvent: () => undefined }, 'old'), 'ordinary');
});
