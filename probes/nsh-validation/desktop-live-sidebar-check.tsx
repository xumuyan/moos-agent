import { expect, open, test } from 'nsh/test';
for (const scheme of ['light', 'dark'] as const) {
  test(`live sidebar first pass ${scheme} reference-sized synthetic content`, async () => {
    const app = await open('./ThemeNative.tsx', { width: 1920, height: 988, colorScheme: scheme, locale: 'zh-CN', reducedMotion: true });
    await app.waitFor('text:项目 主题验证 A');
    await app.type('id:prompt', '【合成参考】侧栏透景，不读取用户聊天');
    await app.press('id:send'); await app.waitFor('text:tool_end · read · 错误');
    await app.press('id:stop');
    await app.waitUntil(() => app.texts().some(t => t.includes('cancelled · 已排空')));
    const state = app.window('main').state();
    expect(state!.contentBounds.size.width).toBe(1920);
    expect(state!.contentBounds.size.height).toBe(988);
    console.log('LIVE_SIDEBAR_FRAME ' + JSON.stringify({ scheme, state, synthetic: true }));
    await app.screenshot(`live-${scheme}-1920.png`);
    await app.setViewport(680,720); await app.waitFor('id:toggle-navigation');
    await app.screenshot(`live-${scheme}-680.png`);
  });
}
