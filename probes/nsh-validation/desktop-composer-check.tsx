import { expect, open, test, type App } from 'nsh/test';
import { assertStyleBounds } from './desktop-style-assert';
import { artAvailable } from './desktop-theme-art';

async function check(app: App, active: boolean, width: number, height: number, sidebar: number, name: string) {
  const state = app.window('main').state()!;
  expect(state.contentBounds.size).toEqual({ width, height });
  expect(state.scaleFactor).toBe(1);
  const b = await assertStyleBounds(app, active, height);
  expect(b['primary-action'].size).toEqual({ width: active ? 38 : 44, height: active ? 38 : 44 });
  expect(b['model-picker'].size.height).toBe(32);
  expect(app.shows('id:bottom-trim')).toBe(!active);
  expect(app.shows('id:bottom-crest')).toBe(artAvailable && !active);
  expect(app.shows('id:composer-bow')).toBe(artAvailable);
  if (!active) {
    expect(b['bottom-trim'].size.width).toBe(width - sidebar);
    expect(b['bottom-trim'].origin.y).toBe(height - 60);
  }
  if (artAvailable) {
    const frame = b['composer-frame'], bow = b['composer-bow'];
    expect(Math.abs(bow.size.width - 360 * 72 / 170)).toBeLessThan(1);
    expect(Math.abs(bow.origin.x + bow.size.width / 2 - frame.size.width / 2)).toBeLessThan(1);
    expect(bow.size.height).toBe(72);
    expect(frame.origin.y + bow.size.height).toBeLessThan(b.prompt.origin.y);
    expect(b.prompt.origin.x).toBeGreaterThan(frame.origin.x + 54);
    expect(b.prompt.origin.x + b.prompt.size.width).toBeLessThan(frame.origin.x + frame.size.width - 54);
  }
  await app.screenshot(name + '.png');
  return b;
}

async function checkPopup(app: App, width: number, height: number) {
  await app.waitUntil(() => app.texts().some(t => t.startsWith('STYLE_GEOMETRY ') && t.includes('model-popup')));
  const b = JSON.parse(app.texts().find(t => t.startsWith('STYLE_GEOMETRY '))!.slice('STYLE_GEOMETRY '.length));
  const popup = b['model-popup'], picker = b['model-picker'];
  const x = b['chat-column'].origin.x + b['chat-body'].origin.x + b['composer-safe-area'].origin.x +
    b.composer.origin.x + b['composer-actions'].origin.x + picker.origin.x;
  const y = b['chat-column'].origin.y + b['chat-body'].origin.y + b['composer-safe-area'].origin.y +
    b.composer.origin.y + b['composer-actions'].origin.y + picker.origin.y;
  expect(popup.size.width).toBe(240);
  expect(popup.size.height).toBeLessThanOrEqual(360);
  expect(popup.origin.x).toBeGreaterThanOrEqual(12);
  expect(popup.origin.y).toBeGreaterThanOrEqual(12);
  expect(popup.origin.x + popup.size.width).toBeLessThanOrEqual(width - 12);
  expect(popup.origin.y + popup.size.height).toBeLessThanOrEqual(height - 12);
  expect(Math.abs(popup.origin.x + popup.size.width - (x + picker.size.width))).toBeLessThan(1);
  expect(Math.abs(popup.origin.y + popup.size.height - (y - 8))).toBeLessThan(1);
  console.log('PICKER_POPUP ' + JSON.stringify({ width, height, popup, x, y }));
}

const action = 'id:primary-action', picker = 'id:model-trigger';
const callCounts = (app: App) => JSON.parse(app.texts().find(t => t.startsWith('COMPOSER_CALLS '))!.slice('COMPOSER_CALLS '.length));
for (const colorScheme of ['light', 'dark'] as const) {
  test(`composer chooses model and swaps a single action in place (${colorScheme})`, async () => {
    const app = await open('./ThemeGeometry.tsx', { width: 1240, height: 820, colorScheme, locale: 'zh-CN', reducedMotion: true });
    await app.waitFor('text:项目 主题验证 A');
    await check(app, false, 1240, 820, 280, `composer-${colorScheme}-wide-idle`);
    await app.press(picker);
    await app.waitFor('id:model-pane-root');
    await checkPopup(app, 1240, 820);
    await app.screenshot(`composer-${colorScheme}-wide-menu.png`);
    await app.press(picker);
    await app.waitUntil(() => !app.shows('id:model-pane-root'));
    await app.setViewport(680, 720);
    expect(app.enabled(action)).toBe(false);
    expect(app.shows('id:icon-stop')).toBe(false);
    expect(app.shows('id:stop')).toBe(false);
    await app.submit('id:prompt');
    expect(app.shows('id:empty-state')).toBe(true);
    await app.press(picker);
    await app.waitFor('id:model-pane-root');
    expect(app.shows('id:model-menu-models')).toBe(true);
    expect(app.shows('id:model-menu-effort')).toBe(true);
    expect(app.shows('id:model-search')).toBe(false);
    await checkPopup(app, 680, 720);
    await app.screenshot(`composer-${colorScheme}-narrow-menu.png`);
    await app.press('id:model-menu-models');
    await app.waitFor('id:model-fixture-alternate-check');
    expect(app.shows('text:合成模型组 A')).toBe(true);
    await checkPopup(app, 680, 720);
    await app.screenshot(`composer-${colorScheme}-narrow-models.png`);
    await app.scroll('id:model-groups', 220);
    await app.waitFor('text:合成模型组 B');
    await app.type('id:model-search', 'no-such-model');
    await app.waitFor('id:model-no-results');
    await app.submit('id:model-search');
    expect(app.shows('id:model-no-results')).toBe(true);
    await app.press('id:model-search-clear');
    await app.waitFor('id:model-fixture');
    await app.type('id:model-search', 'NS71');
    await app.waitFor('id:model-no-results');
    await app.press('id:model-search-clear');
    await app.keyboard.press('escape');
    await app.waitFor('id:model-pane-root');
    await app.keyboard.press('escape');
    await app.waitUntil(() => !app.shows('id:model-pane-root'));
    await app.press(picker);
    await app.press('id:model-menu-models');
    await app.type('id:model-search', 'NS2L');
    await app.waitUntil(() => app.shows('id:model-demo-2') && !app.shows('id:model-fixture-alternate'));
    await app.submit('id:model-search');
    await app.waitFor('text:nsh-2-local');
    expect(app.shows('id:model-pane-models')).toBe(false);
    await app.press(picker);
    await app.waitFor('id:model-pane-root');
    expect(app.shows('id:model-menu-effort')).toBe(false);
    await app.press('id:model-menu-models');
    await app.waitFor('id:model-fixture-alternate');
    await app.press('id:model-fixture-alternate');
    await app.waitFor('id:selected-effort');
    await app.press(picker);
    await app.press('id:model-menu-effort');
    await app.waitFor('id:effort-high-check');
    await checkPopup(app, 680, 720);
    await app.screenshot(`composer-${colorScheme}-narrow-effort.png`);
    await app.press('id:effort-low');
    await app.waitFor('text:· Low');
    expect(app.shows('id:model-pane-effort')).toBe(false);
    await app.press(picker);
    await app.waitFor('id:model-pane-root');
    await app.press('id:session-第二会话');
    await app.waitFor('text:· High');
    expect(app.shows('id:model-pane-root')).toBe(false);
    await app.press('id:session-独立会话');
    await app.waitFor('text:· Low');
    const draft = `合成窄窗输入 ${colorScheme}`;
    await app.type('id:prompt', draft);
    expect(app.enabled(action)).toBe(true);
    await check(app, false, 680, 720, 184, `composer-${colorScheme}-narrow-draft`);
    if (colorScheme === 'light') await app.press(action);
    else await app.submit('id:prompt');
    expect(app.shows('id:icon-stop')).toBe(true);
    expect(app.shows('id:icon-send')).toBe(false);
    expect(app.enabled(action)).toBe(false); // awaiting the admission response, no task ID yet
    await app.waitFor('text:读取 · 失败');
    expect(app.shows('text:' + draft)).toBe(true);
    expect(app.enabled(picker)).toBe(false);
    expect(app.enabled(action)).toBe(true);
    const running = await check(app, true, 680, 720, 184, `composer-${colorScheme}-narrow-running`);
    expect(callCounts(app)).toEqual({ sentModel: 'fixture-alternate', sentEffort: 'low', submitCount: 1, cancelCount: 0 });
    await app.type('id:prompt', '下一轮草稿');
    await app.submit('id:prompt'); // Return is not a stop shortcut or a second submit
    expect(callCounts(app)).toEqual({ sentModel: 'fixture-alternate', sentEffort: 'low', submitCount: 1, cancelCount: 0 });
    await app.press(action);
    await app.waitUntil(() => !app.enabled(action) && callCounts(app).cancelCount === 0);
    expect(app.shows('id:icon-stop')).toBe(true);
    await app.waitUntil(() => callCounts(app).cancelCount === 1);
    expect(app.shows('id:icon-stop')).toBe(true); // acknowledgment is not terminal
    expect(app.enabled(action)).toBe(false);
    await app.waitUntil(() => app.texts().some(t => t.includes('cancelled · 停止请求中，等待收尾 · 4 事件')));
    expect(app.shows('id:icon-stop')).toBe(true); // terminal page still has more events
    expect(app.enabled(action)).toBe(false);
    await app.waitUntil(() => app.texts().some(t => t.includes('cancelled · 已排空 · 5 事件')));
    await app.waitFor('id:icon-send');
    expect(app.shows('id:icon-stop')).toBe(false);
    expect(app.enabled(action)).toBe(true); // next draft is still present
    expect(app.enabled(picker)).toBe(true);
    expect(callCounts(app)).toEqual({ sentModel: 'fixture-alternate', sentEffort: 'low', submitCount: 1, cancelCount: 1 });
    const stopped = await assertStyleBounds(app, true, 720);
    expect(stopped['primary-action']).toEqual(running['primary-action']);
    await app.setViewport(1240, 820);
    await check(app, true, 1240, 820, 280, `composer-${colorScheme}-wide-stopped`);
  });
}
