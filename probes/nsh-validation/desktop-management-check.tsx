import { expect, open, test } from 'nsh/test';
import type { Calls } from './desktop-contract';

const records = (app: { texts: () => string[] }) =>
  JSON.parse(app.texts().find(text => text.startsWith('N01_MANAGEMENT_TEST '))?.slice('N01_MANAGEMENT_TEST '.length) ?? '[]') as
    { name: string; data: unknown }[];

test('default theme session menu renames and pins a real sidebar row', async () => {
  const app = await open('./App.tsx', { width: 1240, height: 820, reducedMotion: true });
  await app.waitFor('id:session-menu-one');
  await app.press('id:session-menu-one');
  await app.waitFor('id:session-action-rename');
  expect(app.shows('id:session-action-fork')).toBe(true);
  await app.screenshot('session-menu.png');
  await app.press('id:session-action-rename');
  await app.waitFor('id:rename-session-dialog');
  await app.paste('id:rename-session-input', { text: '已改名会话' });
  await app.press('id:rename-session-save');
  await app.waitFor('id:session-已改名会话');
  await app.press('id:session-quick-pin-one');
  await app.waitUntil(() => records(app).filter(call => call.name === 'sessions.manage').length === 2);
});

test('archives can be restored and opened from the workspace menu', async () => {
  const app = await open('./App.tsx', { width: 1240, height: 820, reducedMotion: true });
  await app.waitFor('id:session-quick-archive-one');
  await app.press('id:session-quick-archive-one');
  await app.waitUntil(() => !app.shows('id:session-设计会话'));
  await app.press('id:nav-more');
  await app.press('id:nav-archived-sessions');
  await app.waitFor('id:restore-session-one');
  await app.screenshot('archived-sessions.png');
  await app.press('id:restore-session-one');
  await app.waitFor('id:session-设计会话');
  expect(app.shows('id:archived-sessions')).toBe(false);
  expect(records(app).filter(call => call.name === 'sessions.manage').map(call => call.data)).toEqual([
    { projectId: 'demo', sessionId: 'one', action: 'archive' },
    { projectId: 'demo', action: 'listArchived' },
    { projectId: 'demo', sessionId: 'one', action: 'restore' },
  ]);
  await app.press('id:nav-more');
  await app.press('id:nav-archived-sessions');
  await app.waitFor('text:这个工作区没有已归档会话');
});

test('shows imported history and attachments without submitting a task', async () => {
  const app = await open('./App.tsx', { width: 1240, height: 820, reducedMotion: true });
  await app.waitFor('id:imported-session-dsh-old');
  await app.press('id:imported-session-dsh-old');
  await app.waitFor('text:原始回复');
  expect(app.shows('id:composer')).toBe(false);
  await app.press('id:imported-asset-1');
  await app.waitFor('id:imported-close-image');
  await app.press('id:imported-close-image');
  await app.press('id:imported-older');
  await app.waitFor('text:原始提问');
  await app.press('id:imported-newer');
  await app.waitFor('text:原始回复');
  expect(records(app).some(call => call.name === 'tasks.submit')).toBe(false);
  expect(records(app).filter(call => call.name === 'sessions.manage').every(call =>
    (call.data as { projectId: string }).projectId === 'demo')).toBe(true);
  await app.press('id:project-隔离验收');
  await app.waitUntil(() => !app.shows('id:imported-session-dsh-old'));
  expect(app.shows('id:imported-history')).toBe(false);
  await app.press('id:project-候选验收');
  await app.waitFor('id:imported-session-dsh-old');
});

test('the bottom-left plus contains the single goal mode and opens a scoped submission', async () => {
  const app = await open('./App.tsx', { width: 1240, height: 820, reducedMotion: true });
  await app.waitFor('id:composer-add');
  expect(app.shows('id:team-goal-toggle')).toBe(false);
  await app.press('id:composer-add');
  await app.waitFor('id:team-goal-toggle');
  await app.screenshot('goal-menu.png');
  await app.press('id:team-goal-toggle');
  await app.waitFor('id:team-goal-selected');
  await app.type('id:prompt', '验收这个目标');
  await app.press('id:primary-action');
  await app.waitFor('id:turn-process');
  expect((records(app).find(call => call.name === 'tasks.submit')?.data as { teamGoal: string }).teamGoal).toBe('start');
  await app.waitFor('text:已完成 · 编辑、运行命令 · 2 项操作');
  await app.waitFor('text:已完成合成验收');
  expect(app.shows('text:编辑 · 完成')).toBe(false);
  expect(app.shows('text:命令 · 开始 · git status --short')).toBe(false);
  expect(app.shows('text:先读取再修改')).toBe(false);
  await app.waitFor('text:test-file.txt');
  expect(app.shows('text:last.txt')).toBe(false);
  await app.screenshot('chat-folded.png');
  await app.press('id:turn-process');
  await app.waitFor('text:先读取再修改');
  await app.waitFor('text:编辑 · 完成');
  await app.waitFor('text:命令 · 开始 · git status --short');
  await app.press('id:workspace-changes-more');
  await app.waitFor('text:last.txt');
  await app.screenshot('chat-disclosures.png');
});

test('slow session switching keeps the current conversation visible and ignores superseded loads', async () => {
  const app = await open('./SessionSwitch.tsx', { width: 1240, height: 820, reducedMotion: true });
  await app.waitFor('text:首个会话的内容');
  await app.press('id:session-慢会话');
  await app.waitFor('id:session-switch-pending');
  expect(app.shows('text:首个会话的内容')).toBe(true);
  expect(app.shows('id:history-loading')).toBe(false);
  expect(app.shows('id:bottom-trim')).toBe(false);
  await app.screenshot('session-switch-pending.png');
  await app.press('id:session-快会话');
  await app.waitFor('text:快会话的内容');
  await app.wait(1000);
  expect(app.shows('text:快会话的内容')).toBe(true);
  expect(app.shows('text:慢会话的内容')).toBe(false);
  const historyCalls = () => records(app).filter(call => call.name === 'sessions.history').length;
  const count = historyCalls();
  await app.press('id:session-设计会话');
  await app.waitFor('text:首个会话的内容');
  expect(historyCalls()).toBe(count);
  expect(app.shows('id:session-switch-pending')).toBe(false);
  await app.screenshot('session-switch-ready.png');
});

test('new conversation stays a draft until its first message is accepted', async () => {
  const app = await open('./App.tsx', { width: 1240, height: 820, reducedMotion: true });
  await app.waitFor('id:session-设计会话');
  await app.press('id:create-session');
  await app.type('id:prompt', '没有发出的草稿');
  expect(app.shows('id:session-新会话 2')).toBe(false);
  expect(records(app).some(call => call.name === 'tasks.submit')).toBe(false);
  await app.press('id:session-设计会话');
  expect(app.value('id:prompt')).toBe('');
  await app.press('id:create-session');
  await app.type('id:prompt', '首条已发送');
  await app.press('id:primary-action');
  await app.waitFor('id:session-新会话 2');
  await app.waitFor('text:已完成合成验收');
  const posts = records(app).filter(call => call.name === 'tasks.submit');
  expect(posts).toHaveLength(1);
  expect((posts[0].data as Calls['tasks.submit']['params']).draft).toBe(true);
  expect(app.value('id:prompt')).toBe('');
});

test('pasting an image into the composer sends a scoped attachment batch', async () => {
  const app = await open('./App.tsx', { width: 1240, height: 820 });
  await app.waitFor('id:composer-add');
  await app.press('id:create-session');
  await app.paste('id:prompt', { files: ['source/fixture-paste.png'] });
  await app.waitFor('id:composer-attachments');
  await app.press('id:primary-action');
  await app.waitFor('id:turn-process');
  const staged = records(app).find(call => call.name === 'images.stage')?.data as Calls['images.stage']['params'];
  const task = records(app).find(call => call.name === 'tasks.submit')?.data as Calls['tasks.submit']['params'];
  expect(staged.mime).toBe('image/png');
  expect(staged.draft).toBe(true);
  expect(task.draft).toBe(true);
  expect(task.imageBatch).toBe(staged.batchId);
  expect(task.sessionId).toBe(staged.sessionId);
});

test('settings adds a model with site-specific protocol and selectable reasoning', async () => {
  const app = await open('./ManagementSettings.tsx', { width: 1240, height: 820, reducedMotion: true });
  await app.waitFor('id:settings-content');
  await app.waitFor('id:settings-add-model');
  await app.waitFor('id:settings-model-list');
  await app.press('id:settings-section-appearance');
  await app.waitFor('id:settings-statistics');
  await app.press('id:settings-section-models');
  await app.waitFor('id:settings-model-list');
  await app.press('id:settings-add-model');
  await app.waitFor('id:model-form');
  await app.type('id:model-service-name', '隔离中转');
  await app.type('id:model-service-url', 'https://example.invalid/v1');
  await app.type('id:model-api-key', 'n01-synthetic-test');
  await app.type('id:model-id', 'synthetic-sol');
  await app.scroll('id:settings-model-details-scroll', 1100);
  await app.press('id:model-effort-high');
  await app.press('id:settings-save-model');
  await app.waitFor('id:settings-add-model-new-relay');
  await app.waitFor('id:settings-model-new-model');
  const save = records(app).filter(call => call.name === 'models.manage').at(-1)?.data as Extract<Calls['models.manage']['params'], { action: 'save' }>;
  expect(save.model.model).toBe('synthetic-sol');
  expect(save.service.name).toBe('隔离中转');
  expect(save.service.baseUrl).toBe('https://example.invalid/v1');
  expect(save.model.efforts).toEqual(['off', 'high']);
  expect(save.service.api).toBe('openai-responses');
  await app.press('id:settings-model-new-model');
  await app.waitFor('id:settings-model-detail');
  expect(app.shows('id:model-form')).toBe(false);
  await app.screenshot('model-services.png');
  await app.scroll('id:settings-model-details-scroll', 800);
  await app.press('id:settings-edit-model');
  await app.waitFor('id:model-form');
  expect(app.shows('id:settings-model-new-model')).toBe(true);
});
