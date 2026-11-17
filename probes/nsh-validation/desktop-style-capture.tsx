// Native macOS test-host content capture, not ScreenCaptureKit or manual GUI evidence.
import { expect, open, test } from 'nsh/test';
test('style_evidence fixed native content canvases and component states (synthetic only)', async () => {
  const app = await open('./ThemeNative.tsx', { width: 1240, height: 820, colorScheme: 'light', locale: 'zh-CN', reducedMotion: true });
  await app.waitFor('text:项目 主题验证 A');
  async function capture(name: string, width: number, height: number) {
    const state = app.window('main').state();
    expect(state !== null).toBe(true);
    expect(state!.scaleFactor).toBe(1);
    expect(state!.contentBounds.size.width).toBe(width);
    expect(state!.contentBounds.size.height).toBe(height);
    console.log('STYLE_FRAME ' + JSON.stringify({ name, state, expectedContent: { width, height }, capture: 'NSH native test host content; excludes outer frame', synthetic: true }));
    await app.screenshot(name + '.png');
  }
  await capture('light-idle', 1240, 820);
  await app.type('id:prompt', '【合成样式证据】读取独立夹具，不是实际用户任务');
  await app.press('id:send'); await app.waitFor('text:tool_end · read · 错误');
  await app.press('id:stop');
  await app.waitUntil(() => app.texts().some(t => t.includes('cancelled · 已排空')));
  await capture('light-chat', 1240, 820);
  await app.press('id:toggle-details'); await app.waitFor('id:details-panel');
  await capture('light-details', 1240, 820);
  await app.setViewport(680, 720); await app.waitFor('id:toggle-navigation');
  await capture('narrow-sidebar', 680, 720);
  await app.press('id:toggle-navigation');
  await capture('narrow-chat', 680, 720);
  await app.setViewport(1240, 820); await app.setColorScheme('dark');
  await capture('dark-details', 1240, 820);
  await app.press('id:toggle-details');
  await capture('dark-chat', 1240, 820);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`style fixed missing matrix ${scheme} idle/chat narrow and wide`, async () => {
    const app = await open('./ThemeNative.tsx', { width: 1240, height: 820, colorScheme: scheme, locale: 'zh-CN', reducedMotion: true });
    await app.waitFor('text:项目 主题验证 A');
    await app.screenshot(`${scheme}-idle.png`);
    await app.setViewport(680, 720);
    await app.screenshot(`${scheme}-narrow-idle-sidebar.png`);
    await app.press('id:toggle-navigation');
    await app.screenshot(`${scheme}-narrow-idle.png`);
    await app.type('id:prompt', '【合成样式证据】短文与工具卡，不是实际用户任务');
    await app.press('id:send'); await app.waitFor('text:tool_end · read · 错误');
    await app.press('id:stop'); await app.waitUntil(() => app.texts().some(t => t.includes('cancelled · 已排空')));
    await app.screenshot(`${scheme}-narrow-chat.png`);
    await app.setViewport(1240, 820); await app.screenshot(`${scheme}-chat.png`);
    await app.press('id:toggle-details'); await app.waitFor('id:details-panel');
    await app.screenshot(`${scheme}-details.png`);
  });
}
