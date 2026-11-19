import { expect, open, test, type App } from 'nsh/test';

function state(app: App) {
  const line = app.texts().find(t => t.startsWith('TURN_QUEUE_STATE '));
  return JSON.parse(line?.slice('TURN_QUEUE_STATE '.length) ?? '{}');
}
async function stage(app: App, text: string) {
  await app.type('id:prompt', text);
  expect(app.value('id:prompt')).toBe(text);
  await app.waitUntil(() => app.enabled('id:queue-submit'));
  console.log(`QUEUE_STAGE ${text} before press`);
  await app.press('id:queue-submit');
  console.log(`QUEUE_STAGE ${text} after press ${JSON.stringify(app.value('id:prompt'))}`);
  await app.waitUntil(() => app.value('id:prompt') === '');
}
async function layout(app: App, name: string) {
  await app.waitUntil(() => !!state(app).geometry?.['turn-queue']);
  const g = state(app).geometry, dock = g['turn-queue'], safe = g['composer-safe-area'];
  expect(dock.origin.x - safe.origin.x).toBe(10);
  expect(g.composer.size.width - dock.size.width).toBe(20);
  expect(dock.origin.y + dock.size.height).toBeLessThan(safe.origin.y + g.composer.origin.y - 20);
  expect(g['primary-action'].size.width).toBe(38);
  expect(app.window('main').state()!.scaleFactor).toBe(1);
  console.log('TURN_QUEUE_GEOMETRY ' + JSON.stringify({ name, dock, safe, composer: g.composer }));
  await app.screenshot(name + '.png');
}
for (const colorScheme of ['light', 'dark'] as const) {
  test(`follow-ups stay scoped, editable and send FIFO only after drain (${colorScheme})`, async () => {
    const app = await open('./ThemeTurnQueue.tsx', { width: 1240, height: 820, colorScheme, locale: 'zh-CN', reducedMotion: true });
    await app.waitFor('text:项目 主题验证 A');
    expect(app.shows('id:turn-queue')).toBe(false);
    await app.type('id:prompt', 'Round one');
    await app.press('id:primary-action');
    await app.waitFor('id:icon-stop');
    await stage(app, 'Round two');
    await app.waitFor('id:queued-text-1');
    expect(state(app).submissions.length).toBe(1);
    await layout(app, `turn-queue-${colorScheme}-1240-single`);
    await app.hover('id:queued-text-1');
    await layout(app, `turn-queue-${colorScheme}-1240-hover`);
    await app.hover('id:prompt');
    await app.setViewport(680, 720);
    await stage(app, 'Round three');
    await app.waitFor('text:2 条排队消息');
    expect(app.shows('id:queued-text-1')).toBe(false);
    await stage(app, 'Remove me');
    await app.press('id:queue-toggle');
    await app.waitFor('id:queued-text-3');
    await app.press('id:queued-remove-3');
    await app.waitFor('text:2 条排队消息');
    if (!app.shows('id:queued-text-1')) await app.press('id:queue-toggle');
    expect(app.shows('id:queued-text-3')).toBe(false);
    await layout(app, `turn-queue-${colorScheme}-680-multiple`);
    await app.press('id:queued-edit-1');
    expect(app.value('id:queued-edit-input')).toBe('Round two');
    await app.clear('id:queued-edit-input');
    expect(app.enabled('id:queued-save')).toBe(false);
    await app.type('id:queued-edit-input', 'Round two edited');
    expect(app.value('id:queued-edit-input')).toBe('Round two edited');
    await layout(app, `turn-queue-${colorScheme}-680-edit`);
    await app.press('id:fixture-success');
    await app.waitUntil(() => state(app).trace.includes('terminal with backlog'));
    expect(state(app).submissions.length).toBe(1);
    expect(app.shows('id:icon-stop')).toBe(true);
    expect(app.enabled('id:primary-action')).toBe(false);
    await app.press('id:fixture-drain');
    await app.waitUntil(() => state(app).trace.includes('first drained'));
    expect(state(app).submissions.length).toBe(1); // edit holds the head even after drain
    await app.press('id:session-第二会话');
    await app.waitFor('id:empty-state');
    expect(app.shows('id:turn-queue')).toBe(false);
    await app.waitUntil(() => state(app).submissions.length === 1);
    await app.press('id:session-独立会话');
    await app.waitUntil(() => state(app).submissions.length === 3 && app.shows('id:icon-send'));
    expect(state(app).submissions).toEqual([
      ['a', 's-a', 'Round one', 'fixture', null], ['a', 's-a', 'Round two', 'fixture', null], ['a', 's-a', 'Round three', 'fixture', null],
    ]); // switching discards the unsaved edit, not the original queued row
    expect(state(app).trace).toEqual(['submit task-1','terminal with backlog','first drained','submit task-2','submit task-3']);
    expect(app.shows('id:turn-queue')).toBe(false);
  }, 45000);
}

test('stop preserves pending text; saving and explicit resume sends only the edited item', async () => {
  const app = await open('./ThemeTurnQueue.tsx', { width: 680, height: 720, colorScheme: 'dark', locale: 'zh-CN', reducedMotion: true });
  await app.waitFor('text:项目 主题验证 A');
  await app.type('id:prompt', 'Hold'); await app.press('id:primary-action');
  await app.waitUntil(() => app.enabled('id:primary-action') && app.shows('id:icon-stop'));
  await stage(app, 'Queued before stop');
  await app.press('id:primary-action');
  await app.waitUntil(() => state(app).trace.includes('terminal with backlog'));
  expect(app.shows('id:queue-resume')).toBe(false);
  expect(state(app).submissions.length).toBe(1);
  await app.press('id:fixture-drain');
  await app.waitFor('id:queue-resume');
  await layout(app, 'turn-queue-dark-680-paused');
  await app.press('id:queued-edit-1');
  await app.clear('id:queued-edit-input');
  await app.type('id:queued-edit-input', 'Edited after stop');
  await app.waitUntil(() => app.value('id:queued-edit-input') === 'Edited after stop' && app.enabled('id:queued-save'));
  await app.press('id:queued-save');
  await app.waitFor('text:Edited after stop');
  expect(state(app).submissions.length).toBe(1);
  await app.press('id:queue-resume');
  await app.waitUntil(() => state(app).submissions.length === 2 && app.shows('id:icon-send'));
  expect(state(app).submissions[1]).toEqual(['a', 's-a', 'Edited after stop', 'fixture', null]);
  expect(state(app).trace).toEqual(['submit task-1','cancel','terminal with backlog','first drained','submit task-2']);
  expect(app.shows('id:turn-queue')).toBe(false);
}, 30000);

test('an uncertain poll never releases a queued prompt', async () => {
  const app = await open('./ThemeTurnQueue.tsx', { width: 680, height: 720, reducedMotion: true });
  await app.waitFor('text:项目 主题验证 A');
  await app.type('id:prompt', 'Hold'); await app.press('id:primary-action');
  await app.waitFor('id:icon-stop');
  await stage(app, 'Keep unsent');
  await app.press('id:fixture-fail');
  await app.waitFor('text:发送状态未确认 · 队列暂停');
  expect(app.shows('id:queue-resume')).toBe(false);
  expect(state(app).submissions.length).toBe(1);
  expect(app.shows('id:queued-text-1')).toBe(true);
});
