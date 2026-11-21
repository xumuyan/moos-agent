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
  expect(app.shows('text:编辑 · 完成')).toBe(false);
  await app.press('id:turn-process');
  await app.waitFor('text:编辑 · 完成');
  await app.press('id:workspace-changes');
  await app.waitFor('text:修改 · test-file.txt');
  await app.screenshot('chat-disclosures.png');
});

test('pasting an image into the composer sends a scoped attachment batch', async () => {
  const app = await open('./App.tsx', { width: 1240, height: 820 });
  await app.waitFor('id:composer-add');
  await app.paste('id:prompt', { files: ['source/fixture-paste.png'] });
  await app.waitFor('id:composer-attachments');
  await app.press('id:primary-action');
  await app.waitFor('id:turn-process');
  const staged = records(app).find(call => call.name === 'images.stage')?.data as Calls['images.stage']['params'];
  const task = records(app).find(call => call.name === 'tasks.submit')?.data as Calls['tasks.submit']['params'];
  expect(staged.mime).toBe('image/png');
  expect(task.imageBatch).toBe(staged.batchId);
  expect(task.sessionId).toBe(staged.sessionId);
});

test('settings adds a model with site-specific protocol and selectable reasoning', async () => {
  const app = await open('./ManagementSettings.tsx', { width: 1240, height: 820, reducedMotion: true });
  await app.waitFor('id:settings-content');
  await app.waitFor('id:settings-add-model');
  await app.scroll('id:settings-scroll', 580);
  await app.press('id:settings-add-model');
  await app.waitFor('id:model-form');
  await app.type('id:model-service-name', '隔离中转');
  await app.type('id:model-service-url', 'https://example.invalid/v1');
  await app.type('id:model-api-key', 'n01-synthetic-test');
  await app.type('id:model-id', 'synthetic-sol');
  await app.scroll('id:settings-scroll', 1100);
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
  await app.screenshot('model-services.png');
});
