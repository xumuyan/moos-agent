import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Store } from '../../services/agent/store.mjs';
import { timelinePayload } from '../../services/agent/timeline-view.mjs';
import { createPiTurnReader } from './pi-turn.mjs';
import { isWorkspaceChangeVisible, withWorkspaceChanges } from './plugin/pi-workspace-changes.js';

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
  assert.equal(reader.read('session-one', 'retry'), null);
  store.updateTask(task.id, { status: 'running' });

  function record(id, toolName, args, isError) {
    store.appendEvent(task.id, 'tool_start', { toolCallId: id, toolName, args });
    if (isError !== undefined) store.appendEvent(task.id, 'tool_end', {
      toolCallId: id, toolName, isError, result: { content: ['private output'] },
    });
  }
  record('write-one', 'write', { path: join(root, 'a.txt'), content: 'private input' }, false);
  record('cache-write', 'write', { path: '.npm/_cacache/hidden' }, false);
  record('edit-one', 'edit', { path: './a.txt', newText: 'private input' }, false);
  record('edit-failed', 'edit', { path: 'b.txt' }, true);
  record('read-outside', 'read', { path: '/outside-private' }, true);
  record('bash', 'bash', { command: 'git status private-argument' }, undefined);
  const live = reader.read('session-one', null);
  assert.equal(live.status, 'running');
  assert.deepEqual(live.actions.at(-1), { label: '运行命令', path: undefined, command: 'git status', state: 'running' });
  assert.deepEqual(live.files, [{ path: 'a.txt', summary: '写入文件、局部修改' }]);
  assert.equal(live.actions[3].state, 'failed');
  assert.doesNotMatch(JSON.stringify(live), /private|user input/);
  store.updateTask(task.id, { status: 'cancelled' });
  assert.equal(reader.read('session-one', null), null);
  assert.deepEqual({ ...reader.read('session-one', 'retry') }, { id: task.id, status: 'cancelled', errorCode: null });
  assert.equal(reader.read('session-two', 'retry'), null);
  const settled = reader.read('session-one', 12);
  assert.equal(settled.status, 'cancelled');
  assert.equal(settled.actions.at(-1).state, 'unrecorded');
  reader.close();
  assert.deepEqual(reader.read('session-one', 12), settled);
  store.appendEvent(task.id, 'workspace_changes', { files: [
    { path: '.npm/_cacache/historical', summary: '新增' },
    { path: 'a.txt', summary: '修改' },
  ], limited: false });
  assert.deepEqual(reader.read('session-one', 12).files, [{ path: 'a.txt', summary: '修改' }]);

  store.createTask({ conversationId: conversation.id, message: 'newer task' });
  assert.equal(reader.read('session-one', 'retry'), null);
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
    await mkdir(join(root, '.npm/_cacache'), { recursive: true });
    await Promise.all(Array.from({ length: 2510 }, (_, i) => writeFile(join(root, '.npm/_cacache', String(i)), 'cache')));

    await rm(join(root, 'remove.txt'));
  }, value => { report = value; });
  assert.deepEqual(report, { files: [
    { path: 'existing.txt', summary: '修改' }, { path: 'remove.txt', summary: '删除' },
    { path: 'shell-created.txt', summary: '新增' },
  ], limited: false });
  assert.equal(git('ls-files', '-s'), index);
});

test('the background panel reads live PI work across projects and excludes finished or unmapped tasks', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'moos-pi-active-')));
  const dbPath = join(root, 'test.sqlite');
  const store = new Store({ dbPath });
  const reader = createPiTurnReader(dbPath, timelinePayload);
  t.after(async () => {
    reader.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  const first = await store.addProject(root);
  const second = await store.addProject(tmpdir());
  function make(project, session, status) {
    const conversation = store.createConversation(project.id);
    if (session) store.setSetting('dsh-session:' + session, conversation.id);
    const task = store.createTask({ conversationId: conversation.id, message: 'private prompt' });
    return store.updateTask(task.id, { status });
  }
  const queued = make(first, 'queued-session', 'queued');
  const running = make(second, 'running-session', 'running');
  make(first, 'finished-session', 'succeeded');
  make(first, 'interrupted-session', 'interrupted');
  make(first, undefined, 'running');
  const rows = () => reader.active().map(row => ({ ...row }));
  assert.deepEqual(rows(), [
    { id: running.id, sessionId: 'running-session', status: 'running', project: second.name },
    { id: queued.id, sessionId: 'queued-session', status: 'queued', project: first.name },
  ]);
  assert.doesNotMatch(JSON.stringify(rows()), /private prompt|\/private\/tmp/);
  store.updateTask(running.id, { status: 'cancelled' });
  store.updateTask(queued.id, { status: 'running' });
  assert.deepEqual(rows().map(row => [row.id, row.status]), [[queued.id, 'running']]);
  store.updateTask(queued.id, { status: 'failed' });
  assert.deepEqual(rows(), []);
});

test('cache visibility filters known generated paths, not ordinary hidden configuration or source', () => {
  for (const path of ['.npm/_cacache/entry', 'apps/ui/node_modules/pkg/index.js', '.cache/data',
    '__pycache__/x.pyc', 'node-compile-cache/a', 'node-addon-native-custom-loader-501/a',
    'dsh-workspace-changes-abc123/a', 'moos-m01-abc123/a']) assert.equal(isWorkspaceChangeVisible(path), false, path);
  for (const path of ['.github/workflows/test.yml', '.gitignore', '.npmrc', 'src/cache.js',
    'package-lock.json', 'Library/source.js', '.local/project.js']) assert.equal(isWorkspaceChangeVisible(path), true, path);
});

test('desktop queue state surfaces only while queued or running (M06 P06.5)', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'moos-pi-desktop-')));
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
  const task = store.createTask({ conversationId: conversation.id, message: 'private prompt' });
  store.setSetting('dsh-session:desktop-session', conversation.id);
  store.setSetting('dsh-turn:desktop-session:3', task.id);
  store.updateTask(task.id, { status: 'running' });
  assert.equal(reader.read('desktop-session', 3)?.desktop, undefined);
  store.appendEvent(task.id, 'desktop_action', { phase: 'queued', owner: 'conversation:other', label: '截取屏幕', queueAhead: 2 });
  let desktop = reader.read('desktop-session', 3)?.desktop;
  assert.deepEqual(desktop, { phase: 'queued', label: '截取屏幕', queueAhead: 2 });
  store.appendEvent(task.id, 'desktop_action', { phase: 'running', owner: 'conversation:other', label: '截取屏幕' });
  desktop = reader.read('desktop-session', 3)?.desktop;
  assert.deepEqual(desktop, { phase: 'running', label: '截取屏幕', queueAhead: null });
  store.appendEvent(task.id, 'desktop_action', { phase: 'done', owner: 'conversation:other', label: '截取屏幕' });
  assert.equal(reader.read('desktop-session', 3)?.desktop, undefined, 'finished phases stop rendering');
  store.appendEvent(task.id, 'tool_start', { toolCallId: 'dt1', toolName: 'desktop_screenshot', args: { scope: 'display' } });
  const actions = reader.read('desktop-session', 3)?.actions ?? [];
  assert.ok(actions.some(action => action.label === '截取屏幕'), 'desktop tools appear in the action list');
});
