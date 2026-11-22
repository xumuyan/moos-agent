import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMessageRows, presentTurns, toolCard } from './desktop-theme.ts';
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

test('a turn keeps progress and final reply separate, counts operations and leaves changes last', () => {
  const rows = [
    { role: '你', body: '处理文件' },
    { role: 'PI 公开文本', body: '先查看文件。\n```js\nsynthetic body\n```' },
    { role: '工具', body: 'tool_start · read' },
    { role: '工具', body: 'tool_end · read' },
    { role: 'PI 公开文本', body: '接着修改。' },
    { role: '工具', body: 'tool_start · edit' },
    { role: '工具', body: 'tool_end · edit' },
    { role: 'PI 公开文本', body: '已修改。' },
    { role: '状态', body: 'succeeded' },
  ];
  const file = { path: 'a.txt', summary: '修改' };
  const changed = new Map([[0, { files: [file], limited: false }]]);
  const view = presentTurns(rows, { live: false, stopping: false, error: '' }, changed);
  assert.deepEqual(view.map(row => row.role), ['你', '执行过程', 'PI 公开文本']);
  const process = JSON.parse(view[1].body);
  assert.equal(process.count, 2);
  assert.deepEqual(process.categories, ['读取', '编辑']);
  assert.equal(process.state, '已完成');
  assert.deepEqual(process.operations.filter(step => step.kind === 'update').map(step => step.body), ['先查看文件。', '接着修改。']);
  assert.equal(view[2].body, '已修改。');
  assert.deepEqual(view[2].changes.files, [file]);
});

test('the same disclosure key stays with a turn through queueing, stopping, and history prepends', () => {
  const rows = [{ role: '你', body: '处理' }, { role: '状态', body: 'queued' }];
  const snapshot = createMessageRows();
  const changed = new Map();
  const queued = presentTurns(rows, { live: true, stopping: false, error: '' }, changed);
  const stopping = presentTurns(rows, { live: true, stopping: true, error: '' }, changed);
  assert.equal(JSON.parse(queued[1].body).state, '等待执行');
  assert.equal(JSON.parse(stopping[1].body).state, '正在停止');
  assert.equal(queued[1].key, stopping[1].key);
  const terminal = presentTurns([...rows, { role: '状态', body: 'cancelled' }], { live: false, stopping: false, error: '' }, changed);
  assert.equal(JSON.parse(terminal[1].body).state, '已停止');
  assert.equal(terminal[1].key, queued[1].key);
  const a = snapshot('session', terminal);
  const b = snapshot('session', [{ key: 'old', role: '你', body: '旧消息' }, ...terminal]);
  assert.equal(b[2], a[1]);
  const failed = presentTurns(rows, { live: false, stopping: false, error: '真实错误码' }, changed);
  assert.equal(JSON.parse(failed[1].body).error, '真实错误码');
});

test('a running turn shows the analysis caption until visible progress arrives', () => {
  const rows = [{ role: '你', body: '处理' }, { role: '状态', body: 'queued' }];
  const state = (items, status) => JSON.parse(presentTurns(items, {
    live: true, stopping: false, error: '', state: status,
  }, new Map())[1].body).state;
  assert.equal(state(rows, 'queued'), '等待执行');
  assert.equal(state(rows, 'running'), '正在分析请求');
  assert.equal(state([...rows, { role: 'PI 公开文本', body: '已开始回复。' }], 'running'), '正在处理');
  assert.equal(state([...rows, { role: '工具', body: 'tool_start · bash' }], 'running'), '正在处理');
});
