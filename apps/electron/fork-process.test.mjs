import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../../services/agent/store.mjs';
import { Scheduler } from '../../services/agent/scheduler.mjs';
import { timelinePayload } from '../../services/agent/timeline-view.mjs';
import { createPiTasks } from './plugin/pi-tasks.js';
import { createPiTurnReader } from './pi-turn.mjs';
import { forkPrefix } from './plugin/pi-fork.js';

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'moos-fork-process-')));
  const dbPath = join(root, 'test.sqlite');
  const store = new Store({ dbPath });
  const tasks = createPiTasks({ store, Scheduler, run: async () => { throw new Error('must not execute'); } });
  const reader = createPiTurnReader(dbPath, timelinePayload);
  t.after(async () => { reader.close(); await tasks.close(); await rm(root, { recursive: true, force: true }); });
  const project = await store.addProject(root);
  const conversation = store.createConversation(project.id);
  store.setSetting('dsh-session:parent', conversation.id);
  function turn(seq, message) {
    const task = store.createTask({ conversationId: conversation.id, message });
    store.updateTask(task.id, { status: 'succeeded' });
    store.setSetting('dsh-turn:parent:' + seq, task.id);
    store.setSetting('dsh-message:' + message, task.id);
    store.appendEvent(task.id, 'tool_start', { toolCallId: message, toolName: 'write', args: { path: message + '.txt', content: 'private' } });
    store.appendEvent(task.id, 'tool_end', { toolCallId: message, toolName: 'write', isError: false });
    return task;
  }
  turn(2, 'first'); turn(8, 'later');
  const events = [
    { seq: 2, type: 'turn/start', data: {} },
    { seq: 3, type: 'user/message', data: { id: 'first', source: { kind: 'user' } } },
    { seq: 7, type: 'turn/end', data: { reason: { kind: 'completed' } } },
    { seq: 8, type: 'turn/start', data: {} },
    { seq: 9, type: 'user/message', data: { id: 'later', source: { kind: 'user' } } },
    { seq: 13, type: 'turn/end', data: { reason: { kind: 'completed' } } },
  ];
  const session = (id = 'child', parent = 'parent', end = 8, cwd = root) => ({
    id, header: { isSeeded: true, parentSession: parent, cwd }, inheritedEventCount: end,
    snapshotEvents: (from, to) => events.filter(e => e.seq >= from && e.seq < to),
  });
  return { root, store, tasks, reader, session, events, project };
}

test('a fork displays only inherited completed PI processes without creating tasks or replaying messages', async t => {
  const f = await fixture(t);
  const count = f.store.listTasks().length;
  await f.tasks.inheritTurns(f.session());
  assert.deepEqual(f.reader.read('child', 2), f.reader.read('parent', 2));
  assert.equal(f.reader.read('child', 8), null);
  assert.equal(f.reader.read('child', null), null);
  assert.equal(f.reader.read('child', 'retry'), null);
  assert.equal(f.store.getSetting('dsh-session:child'), undefined, 'no new PI conversation until user submits');
  assert.equal(f.store.listTasks().length, count);
  f.reader.close();
  assert.deepEqual(f.reader.read('child', 2), f.reader.read('parent', 2));
  assert.doesNotMatch(JSON.stringify(f.reader.read('child', 2)), /private/);
});

test('nested forks inherit only the selected prefix and prefer their own later task mappings', async t => {
  const f = await fixture(t);
  await f.tasks.inheritTurns(f.session());
  await f.tasks.inheritTurns(f.session('grandchild', 'child'));
  assert.deepEqual(f.reader.read('grandchild', 2), f.reader.read('parent', 2));
  const conversation = f.store.createConversation(f.project.id);
  f.store.setSetting('dsh-session:child', conversation.id);
  const own = f.store.createTask({ conversationId: conversation.id, message: 'own task' });
  f.store.setSetting('dsh-turn:child:8', own.id);
  assert.equal(f.reader.read('child', 8).status, 'queued');
  assert.equal(f.reader.read('grandchild', 8), null);
});

test('cross-workspace, incomplete, mismatched-message and unknown-parent prefixes do not expose tasks', async t => {
  const f = await fixture(t);
  const outside = join(f.root, 'other'); await mkdir(outside);
  await f.tasks.inheritTurns(f.session('foreign', 'parent', 8, outside));
  assert.equal(f.reader.read('foreign', 2), null);
  await f.tasks.inheritTurns(f.session('partial', 'parent', 7));
  assert.equal(f.reader.read('partial', 2), null);
  await f.tasks.inheritTurns(f.session('unknown', 'unknown'));
  assert.equal(f.reader.read('unknown', 2), null);
  f.events[1].data.id = 'later';
  await f.tasks.inheritTurns(f.session('mismatch'));
  assert.equal(f.reader.read('mismatch', 2), null);
});

test('ordinary DSH forks without parentSession resolve their trusted inherited message IDs', async t => {
  const f = await fixture(t);
  const session = f.session();
  delete session.header.parentSession;
  await f.tasks.inheritTurns(session);
  assert.deepEqual(f.reader.read('child', 2), f.reader.read('parent', 2));
  assert.equal(f.reader.read('child', 8), null);
});

test('unavailable or tampered inherited references stay hidden and do not become live tasks', async t => {
  const f = await fixture(t);
  await f.tasks.inheritTurns(f.session());
  const taskId = f.store.getSetting('dsh-message:first');
  f.store.updateTask(taskId, { status: 'failed' });
  assert.equal(f.reader.read('child', 2), null);
  f.store.updateTask(taskId, { status: 'succeeded' });
  f.store.setSetting('dsh-inherited-turn:child:2', '{');
  assert.equal(f.reader.read('child', 2), null);
  f.store.setSetting('dsh-inherited-turn:child:2', JSON.stringify({ taskId, projectId: f.project.id, messageId: 'later' }));
  assert.equal(f.reader.read('child', 2), null);
  assert.deepEqual(f.reader.active(), []);
});

test('turns outside the 1600-event inherited window are never examined and gain no process', async t => {
  const f = await fixture(t);
  const count = f.store.listTasks().length;
  // 窗口外与窗口内各一个完整轮次，映射齐备；窗口外轮次必须不被检查、不获得引用。
  f.store.setSetting('dsh-turn:parent:0', f.store.getSetting('dsh-message:first'));
  f.store.setSetting('dsh-message:outside', f.store.getSetting('dsh-message:first'));
  f.store.setSetting('dsh-turn:parent:102', f.store.getSetting('dsh-message:first'));
  const end = 1700;
  const events = [
    { seq: 0, type: 'turn/start', data: {} },
    { seq: 1, type: 'user/message', data: { id: 'outside', source: { kind: 'user' } } },
    { seq: 97, type: 'turn/end', data: { reason: { kind: 'completed' } } },
    { seq: 102, type: 'turn/start', data: {} },
    { seq: 103, type: 'user/message', data: { id: 'first', source: { kind: 'user' } } },
    { seq: 107, type: 'turn/end', data: { reason: { kind: 'completed' } } },
  ];
  const windows = [];
  const session = {
    id: 'child', header: { isSeeded: true, parentSession: 'parent', cwd: f.root }, inheritedEventCount: end,
    snapshotEvents: (from, to) => { windows.push([from, to]); return events.filter(e => e.seq >= from && e.seq < to); },
  };
  await f.tasks.inheritTurns(session);
  assert.deepEqual(windows, [[end - 1600, end]], '只请求末尾 1600 事件窗口');
  assert.ok(f.store.getSetting('dsh-inherited-turn:child:102'), '窗口内轮次获得引用');
  assert.equal(f.store.getSetting('dsh-inherited-turn:child:0'), undefined, '窗口外轮次不获得引用');
  assert.deepEqual(f.reader.read('child', 102), f.reader.read('parent', 2));
  assert.equal(f.reader.read('child', 0), null);
  assert.equal(f.store.listTasks().length, count, '不创建新任务');
});

test('forkPrefix reads only the final 1600-event window and keeps the 48-message budget', () => {
  const events = [];
  for (let turn = 0; turn < 100; turn++) {
    const base = turn * 17;
    events.push(
      { seq: base, type: 'turn/start', data: {}, time: base },
      { seq: base + 1, type: 'user/message', data: { id: `m${turn}`, source: { kind: 'user' }, content: [{ type: 'text', text: `问题 ${turn}` }] }, time: base + 1 },
      { seq: base + 2, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: `回答 ${turn}` }] } }, time: base + 2 },
      { seq: base + 3, type: 'turn/end', data: { reason: { kind: 'completed' } }, time: base + 3 });
  }
  const end = 1700;
  const windows = [];
  const session = {
    header: { isSeeded: true }, inheritedEventCount: end,
    snapshotEvents: (from, to) => { windows.push([from, to]); return events.filter(e => e.seq >= from && e.seq < to); },
  };
  const prefix = forkPrefix(session);
  assert.deepEqual(windows, [[end - 1600, end]]);
  assert.equal(prefix.checkpoint, 'm99', '检查点是窗口内最后一个完成轮次的用户消息');
  assert.equal(prefix.history.length, 48, '历史保留最后 48 条消息（24 个完整轮次）');
  assert.match(prefix.history[0].text, /问题 76/);
  assert.match(prefix.history.at(-1).text, /回答 99/);
  assert.ok(prefix.history.every(item => Number(item.text.match(/\d+/)?.[0]) >= 76), '窗口外与预算外轮次不进入历史');
});
