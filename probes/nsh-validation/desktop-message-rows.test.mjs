import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMessageRows, toolCard } from './desktop-theme.ts';
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

test('tool cards project public phase without treating Markdown as a tool event', () => {
  for (const dark of [false, true]) {
    const cases = [
      ['tool_start · read', 'start', '读取 · 开始'],
      ['tool_end · read · 错误', 'error', '读取 · 失败'],
      ['tool_end · write', 'end', '写入 · 完成'],
    ];
    for (const [body, phase, label] of cases) {
      const card = toolCard('工具', body, dark);
      assert.equal(card.phase, phase);
      assert.equal(card.label, label);
      for (const role of ['你', 'PI 公开文本', '状态']) assert.equal(toolCard(role, body, dark), null);
    }
    for (const body of ['tool_start · read · 错误', 'tool_end · read\n', 'tool_end · __proto__', 'tool_end · read · extra']) {
      assert.equal(toolCard('工具', body, dark), null);
    }
    for (const name of ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls', 'other']) {
      assert.equal(toolCard('工具', `tool_start · ${name}`, dark).name, name);
    }
  }
});
