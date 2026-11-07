import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Store } from '../../services/agent/store.mjs';
import { timelinePayload } from '../../services/agent/timeline-view.mjs';
import { createPiTurnReader } from './pi-turn.mjs';
import { withWorkspaceChanges } from './plugin/pi-workspace-changes.js';

test('PI turn summaries keep verified actions and workspace paths while excluding tool inputs and outputs', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'moos-pi-turn-')));
  const dbPath = join(root, 'test.sqlite');
  const store = new Store({ dbPath });
  const reader = createPiTurnReader(dbPath, timelinePayload);
  t.after(async () => {
    reader.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  const project = await store.addProject(root);
  const conversation = store.createConversation(project.id);
  const task = store.createTask({ conversationId: conversation.id, message: 'user input' });
  store.setSetting('dsh-session:session-one', conversation.id);
  store.setSetting('dsh-turn:session-one:12', task.id);
  const other = store.createConversation(project.id);
  store.setSetting('dsh-session:session-two', other.id);
  store.setSetting('dsh-turn:session-two:12', task.id); // wrong ownership is ignored
  assert.equal(reader.read('session-two', 12), null);
  assert.equal(reader.read('session-one', 14), null);
  assert.throws(() => reader.read('session-one', '12'));
  store.updateTask(task.id, { status: 'running' });

  function record(id, toolName, args, isError) {
    store.appendEvent(task.id, 'tool_start', { toolCallId: id, toolName, args });
    if (isError !== undefined) store.appendEvent(task.id, 'tool_end', {
      toolCallId: id, toolName, isError, result: { content: ['private output'] },
    });
  }
  record('write-one', 'write', { path: join(root, 'a.txt'), content: 'private input' }, false);
  record('edit-one', 'edit', { path: './a.txt', newText: 'private input' }, false);
  record('edit-failed', 'edit', { path: 'b.txt' }, true);
  record('read-outside', 'read', { path: '/outside-private' }, true);
  record('bash', 'bash', { command: 'git status private-argument' }, undefined);
  const live = reader.read('session-one', null);
  assert.equal(live.status, 'running');
  assert.deepEqual(live.actions.at(-1), { label: '运行命令', path: undefined, command: 'git status', state: 'running' });
  assert.deepEqual(live.files, [{ path: 'a.txt', summary: '写入文件、局部修改' }]);
  assert.equal(live.actions[2].state, 'failed');
  assert.doesNotMatch(JSON.stringify(live), /private|user input/);
  store.updateTask(task.id, { status: 'cancelled' });
  assert.equal(reader.read('session-one', null), null);
  const settled = reader.read('session-one', 12);
  assert.equal(settled.status, 'cancelled');
  assert.equal(settled.actions.at(-1).state, 'unrecorded');
  reader.close();
  assert.deepEqual(reader.read('session-one', 12), settled);
});

test('the workspace summary detects command changes without including pre-existing dirty files or changing the index', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'moos-pi-git-turn-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  await writeFile(join(root, 'existing.txt'), 'old');
  await writeFile(join(root, 'remove.txt'), 'old');
  await writeFile(join(root, 'dirty.txt'), 'clean');
  git('add', '.');
  git('-c', 'user.name=Moos Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'baseline');
  await writeFile(join(root, 'dirty.txt'), 'unrelated dirty edit');
  const index = git('ls-files', '-s');
  let report;
  await withWorkspaceChanges(root, new AbortController().signal, async () => {
    await writeFile(join(root, 'existing.txt'), 'new');
    await writeFile(join(root, 'shell-created.txt'), 'created');
    await rm(join(root, 'remove.txt'));
  }, value => { report = value; });
  assert.deepEqual(report, { files: [
    { path: 'existing.txt', summary: '修改' }, { path: 'remove.txt', summary: '删除' },
    { path: 'shell-created.txt', summary: '新增' },
  ], limited: false });
  assert.equal(git('ls-files', '-s'), index);
});
