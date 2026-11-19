// Native macOS test-host content capture, not ScreenCaptureKit or manual GUI evidence.
import { expect, open, test } from 'nsh/test';
async function capture(app: any, name: string, width: number, height: number) {
    const state = app.window('main').state();
    expect(state !== null).toBe(true);
    expect(state!.scaleFactor).toBe(1);
    expect(state!.contentBounds.size.width).toBe(width);
    expect(state!.contentBounds.size.height).toBe(height);
    console.log('STYLE_FRAME ' + JSON.stringify({ name, state, expectedContent: { width, height }, capture: 'NSH native test host content; excludes outer frame', synthetic: true }));
    await app.screenshot(name + '.png');
  }

test('style_evidence fixed native content canvases and component states (synthetic only)', async () => {
  const app = await open('./ThemeNative.tsx', { width: 1240, height: 820, colorScheme: 'light', locale: 'zh-CN', reducedMotion: true });
  await app.waitFor('text:项目 主题验证 A');
  await capture(app, 'legacy-' + 'light-idle', 1240, 820);
  await app.type('id:prompt', '【合成样式证据】读取独立夹具，不是实际用户任务');
  await app.press('id:send'); await app.waitFor('text:读取 · 失败');
  await app.press('id:stop');
  await app.waitUntil(() => app.texts().some(t => t.includes('cancelled · 已排空')));
  await capture(app, 'legacy-' + 'light-chat', 1240, 820);
  await app.press('id:toggle-details'); await app.waitFor('id:details-panel');
  await capture(app, 'legacy-' + 'light-details', 1240, 820);
  await app.setViewport(680, 720); await app.waitFor('id:toggle-navigation');
  await capture(app, 'legacy-' + 'narrow-sidebar', 680, 720);
  await app.press('id:toggle-navigation');
  await capture(app, 'legacy-' + 'narrow-chat', 680, 720);
  await app.setViewport(1240, 820); await app.setColorScheme('dark');
  await capture(app, 'legacy-' + 'dark-details', 1240, 820);
  await app.press('id:toggle-details');
  await capture(app, 'legacy-' + 'dark-chat', 1240, 820);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`style fixed missing matrix ${scheme} idle/chat narrow and wide`, async () => {
    const app = await open('./ThemeNative.tsx', { width: 1240, height: 820, colorScheme: scheme, locale: 'zh-CN', reducedMotion: true });
    await app.waitFor('text:项目 主题验证 A');
    await capture(app, `${scheme}-idle`, 1240, 820);
    await app.setViewport(680, 720);
    await capture(app, `${scheme}-narrow-idle-sidebar`, 680, 720);
    await app.press('id:toggle-navigation');
    await capture(app, `${scheme}-narrow-idle`, 680, 720);
    await app.type('id:prompt', '【合成样式证据】短文与工具卡，不是实际用户任务');
    await app.press('id:send'); await app.waitFor('text:读取 · 失败');
    await app.press('id:stop'); await app.waitUntil(() => app.texts().some(t => t.includes('cancelled · 已排空')));
    await capture(app, `${scheme}-narrow-chat`, 680, 720);
    await app.setViewport(1240, 820); await capture(app, `${scheme}-chat`, 1240, 820);
    await app.press('id:toggle-details'); await app.waitFor('id:details-panel');
    await capture(app, `${scheme}-details`, 1240, 820);
  });
}
