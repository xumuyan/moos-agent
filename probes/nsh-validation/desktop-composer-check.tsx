import { expect, open, test, type App } from 'nsh/test';
import { assertStyleBounds } from './desktop-style-assert';
import { artAvailable } from './desktop-theme-art';

async function check(app: App, active: boolean, width: number, height: number, sidebar: number, name: string) {
  const state = app.window('main').state()!;
  expect(state.contentBounds.size).toEqual({ width, height });
  expect(state.scaleFactor).toBe(1);
  const b = await assertStyleBounds(app, active, height);
  expect(b.send.size).toEqual({ width: active ? 38 : 44, height: active ? 38 : 44 });
  expect(b.stop.size.height).toBe(36);
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
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`composer centered decoration, narrow input and independent send/stop (${colorScheme})`, async () => {
    const app = await open('./ThemeGeometry.tsx', { width: 1240, height: 820, colorScheme, locale: 'zh-CN', reducedMotion: true });
    await app.waitFor('text:项目 主题验证 A');
    await check(app, false, 1240, 820, 280, `composer-${colorScheme}-wide-idle`);
    await app.setViewport(680, 720);
    expect(app.enabled('id:send')).toBe(false);
    expect(app.enabled('id:stop')).toBe(false);
    await app.submit('id:prompt');
    expect(app.shows('id:empty-state')).toBe(true);
    const draft = `合成窄窗输入 ${colorScheme}`;
    await app.type('id:prompt', draft);
    expect(app.enabled('id:send')).toBe(true);
    await check(app, false, 680, 720, 184, `composer-${colorScheme}-narrow-draft`);
    if (colorScheme === 'light') await app.press('id:send');
    else await app.submit('id:prompt');
    await app.waitFor('text:读取 · 失败');
    expect(app.shows('text:' + draft)).toBe(true);
    expect(app.enabled('id:send')).toBe(false);
    expect(app.enabled('id:stop')).toBe(true);
    await check(app, true, 680, 720, 184, `composer-${colorScheme}-narrow-running`);
    await app.press('id:stop');
    await app.waitUntil(() => app.texts().some(t => t.includes('cancelled · 已排空')));
    expect(app.enabled('id:stop')).toBe(false);
    expect(app.enabled('id:send')).toBe(false);
    await app.setViewport(1240, 820);
    await check(app, true, 1240, 820, 280, `composer-${colorScheme}-wide-stopped`);
  });
}
