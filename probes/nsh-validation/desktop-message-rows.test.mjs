import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMessageRows } from './desktop-theme.ts';
test('presentation rows preserve height identity through polls but update mutated stream text', () => {
  const snapshot = createMessageRows(), rows = [{ role: '你', body: 'hello' }, { role: 'PI', body: 'chunk' }];
  const a = snapshot('p/s', rows);
  assert.notEqual(a[1], rows[1]);
  assert.equal(snapshot('p/s', rows), a);
  rows[1].body += ' two';
  const b = snapshot('p/s', rows);
  assert.notEqual(b, a); assert.equal(b[0], a[0]); assert.notEqual(b[1], a[1]);
  assert.equal(a[1].body, 'chunk'); assert.equal(b[1].body, 'chunk two');
  rows.push({ role: '工具', body: 'tool_end' });
  const c = snapshot('p/s', rows); assert.equal(c[1], b[1]); assert.equal(c.length, 3);
  assert.equal(snapshot('p/s', rows), c);
});
test('presentation row identity never crosses project/session or truncation boundaries', () => {
  const snapshot = createMessageRows(), row = { role: 'PI', body: 'same' };
  const a = snapshot('one', [row]), b = snapshot('two', [row]);
  assert.notEqual(a, b); assert.notEqual(a[0], b[0]);
  assert.deepEqual(snapshot('two', []), []);
  assert.notEqual(snapshot('two', [row])[0], b[0]);
});
