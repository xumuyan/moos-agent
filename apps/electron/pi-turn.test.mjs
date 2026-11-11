import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

test('desktop screenshots expose only ids to the read model and are read back through the restricted bridge', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'moos-pi-shot-')));
  const dbPath = join(root, 'test.sqlite');
  const store = new Store({ dbPath });
  const shotsRoot = join(root, 'sessions', 'screenshots');
  const reader = createPiTurnReader(dbPath, timelinePayload, { screenshotsRoot: shotsRoot });
  t.after(async () => {
    reader.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  const project = await store.addProject(root);
  const conversation = store.createConversation(project.id);
  const task = store.createTask({ conversationId: conversation.id, message: 'private input' });
  store.setSetting('dsh-session:session-one', conversation.id);
  store.setSetting('dsh-turn:session-one:12', task.id);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const shotId = '20261112100000-abcdef123456';
  const shotDir = join(shotsRoot, 'conversation_' + conversation.id);
  const shotPath = join(shotDir, shotId + '.png');
  await mkdir(shotDir, { recursive: true });
  await writeFile(shotPath, png);
  store.appendEvent(task.id, 'desktop_screenshot', {
    shotId, scope: 'display', imageWidth: 64, imageHeight: 32, size: png.length, savedTo: shotPath });
  store.appendEvent(task.id, 'desktop_screenshot', { shotId: 'garbage-id', savedTo: '/etc/passwd' });

  // 读取模型只暴露 ID 与尺寸；路径与图像内容绝不进入读取模型。
  const live = reader.read('session-one', null);
  assert.deepEqual(live.shots, [{ id: shotId, width: 64, height: 32 }]);
  assert.doesNotMatch(JSON.stringify(live), /savedTo|screenshots|\.png/);

  // 受限读取：归属会话 + 事件登记的 ID 才能取到 PNG 字节。
  const shot = reader.shot('session-one', shotId);
  assert.deepEqual({ id: shot.id, mime: shot.mime }, { id: shotId, mime: 'image/png' });
  assert.deepEqual(shot.data, png);

  // 拒绝：非法 ID、未知会话、未登记 ID、越界路径。
  assert.equal(reader.shot('session-one', 'garbage-id'), null);
  assert.equal(reader.shot('unknown-session', shotId), null);
  assert.equal(reader.shot('session-one', '20261112100000-000000000000'), null);
  assert.equal(reader.shot('session-one', shotId + ' '), null);
  const forged = join(root, 'forged.png');
  await writeFile(forged, png);
  store.appendEvent(task.id, 'desktop_screenshot', {
    shotId: '20261112100001-abcdef123456', scope: 'display', imageWidth: 1, imageHeight: 1,
    size: png.length, savedTo: forged });
  assert.equal(reader.shot('session-one', '20261112100001-abcdef123456'), null, 'files outside the screenshots root are refused');

  // 符号链接逃逸：登记名在根内但 realpath 落到根外，拒绝。
  const escape = join(root, 'escape.png');
  await writeFile(escape, png);
  const linkPath = join(shotDir, '20261112100002-abcdef123456.png');
  await symlink(escape, linkPath);
  store.appendEvent(task.id, 'desktop_screenshot', {
    shotId: '20261112100002-abcdef123456', scope: 'display', imageWidth: 1, imageHeight: 1,
    size: png.length, savedTo: linkPath });
  assert.equal(reader.shot('session-one', '20261112100002-abcdef123456'), null, 'symlink escape is refused');

  // 非 PNG 字节与超大小上限拒绝。
  const textPath = join(shotDir, '20261112100003-abcdef123456.png');
  await writeFile(textPath, 'not a png');
  store.appendEvent(task.id, 'desktop_screenshot', {
    shotId: '20261112100003-abcdef123456', scope: 'display', imageWidth: 1, imageHeight: 1,
    size: 9, savedTo: textPath });
  assert.equal(reader.shot('session-one', '20261112100003-abcdef123456'), null, 'non-png bytes are refused');
  const capped = createPiTurnReader(dbPath, timelinePayload, { screenshotsRoot: shotsRoot, maxShotBytes: 4 });
  try { assert.equal(capped.shot('session-one', shotId), null, 'oversized files are refused'); } finally { capped.close(); }

  // 其他会话拿不到这个截图（跨会话隔离）。
  const other = store.createConversation(project.id);
  const otherTask = store.createTask({ conversationId: other.id, message: 'private input' });
  store.setSetting('dsh-session:session-two', other.id);
  store.setSetting('dsh-turn:session-two:12', otherTask.id);
  assert.equal(reader.shot('session-two', shotId), null);

  // 默认根目录缺失时拒绝（fail-closed），且读取模型不受影响。
  const plain = createPiTurnReader(dbPath, timelinePayload);
  try { assert.equal(plain.shot('session-one', shotId), null); } finally { plain.close(); }
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
  for (const toolName of ['desktop_begin', 'desktop_end']) {
    store.appendEvent(task.id, 'tool_start', { toolCallId: toolName, toolName,
      args: { transactionId: 'private-lease', observationId: 'private-observation' } });
    store.appendEvent(task.id, 'tool_end', { toolCallId: toolName, toolName, isError: false,
      result: { details: { focus: { role: 'private-focus' } }, content: ['private-output'] } });
  }
  const summary = reader.read('desktop-session', 3);
  assert.ok(summary.actions.some(a => a.label === '开始桌面事务'));
  assert.ok(summary.actions.some(a => a.label === '验证并结束桌面事务'));
  assert.doesNotMatch(JSON.stringify(summary), /private-/);
  store.appendEvent(task.id, 'desktop_action', { phase: 'queued', label: 'stale' });
  for (const status of ['succeeded', 'failed', 'cancelled', 'interrupted']) {
    store.updateTask(task.id, { status });
    assert.equal(reader.read('desktop-session', 3)?.desktop, undefined, status);
  }
  const actions = reader.read('desktop-session', 3)?.actions ?? [];
  assert.ok(actions.some(action => action.label === '截取屏幕'), 'desktop tools appear in the action list');
});

// Existing desktop lifecycle test also covers stale last-event cleanup on task terminal states.

test('queued turns report the number of tasks waiting ahead; settled turns do not', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'moos-pi-turn-queue-')));
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
  const first = store.createTask({ conversationId: conversation.id, message: 'first input' });
  const second = store.createTask({ conversationId: conversation.id, message: 'second input' });
  const third = store.createTask({ conversationId: conversation.id, message: 'third input' });
  store.setSetting('dsh-session:queue-session', conversation.id);

  const live = () => reader.read('queue-session', null);
  assert.deepEqual([live().status, live().queueAhead], ['queued', 2], 'newest queued task sees two ahead');
  store.updateTask(first.id, { status: 'running' });
  assert.deepEqual([live().status, live().queueAhead], ['queued', 1], 'promotion shrinks the reported queue');
  store.updateTask(second.id, { status: 'failed', errorCode: 'timeout' });
  assert.deepEqual([live().status, live().queueAhead], ['queued', 0], 'only queued tasks count as ahead');
  store.updateTask(third.id, { status: 'running' });
  const running = live();
  assert.equal(running.status, 'running');
  assert.equal(running.queueAhead, undefined, 'running tasks do not carry a queue position');
  store.updateTask(first.id, { status: 'succeeded' });
  store.updateTask(third.id, { status: 'succeeded' });
  assert.equal(live(), null, 'no live queued/running task remains');
  assert.equal(reader.read('queue-session', 'retry'), null, 'succeeded last task is not a retry candidate');
});
