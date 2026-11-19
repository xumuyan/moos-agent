// Synthetic content only; no real user messages or Font/Host permissions.
import { expect, open, test } from 'nsh/test';

for (const scheme of ['light', 'dark'] as const) {
  test(`native typography, code and narrow one-line title ${scheme}`, async () => {
    const app = await open('./ThemeTypography.tsx', { width: 1240, height: 820, colorScheme: scheme, locale: 'zh-CN', reducedMotion: true });
    await app.waitFor('text:项目 主题验证 A');
    await app.waitFor('text:Maid Atelier · 合成会话');
    await app.screenshot(`type-${scheme}-wide-idle.png`);
    await app.type('id:prompt', '中文输入 · Maid 012');
    await app.press('id:send');
    await app.waitFor('text:tool_end · read · 错误');
    await app.waitUntil(() => app.texts().some(t => t.includes('file_01.ts')) && app.texts().some(t => t.includes('const WMWM')));
    await app.press('id:stop');
    await app.waitUntil(() => app.texts().some(t => t.includes('cancelled · 已排空')));
    await app.screenshot(`type-${scheme}-wide-chat.png`);
    await app.setViewport(680, 720);
    await app.waitFor('id:toggle-navigation');
    await app.press('id:toggle-navigation');
    await app.waitFor('text:tool_end · read · 错误');
    await app.screenshot(`type-${scheme}-narrow-chat.png`);
    await app.press('id:toggle-navigation');
    await app.press('id:session-' + '很长的会话标题用于验证截断'.repeat(6) + ' · Maid Atelier');
    await app.waitFor('id:empty-state');
    await app.waitUntil(() => app.texts().some(t => t.startsWith('TYPE_GEOMETRY ') && t.includes('chat-title') && t.includes('selection')));
    const b = JSON.parse(app.texts().find(t => t.startsWith('TYPE_GEOMETRY '))!.slice('TYPE_GEOMETRY '.length));
    const title = b['chat-title'];
    expect(title.size.width).toBeGreaterThan(0);
    expect(title.origin.x + title.size.width).toBeLessThan(b['chat-header'].size.width - 40);
    expect(title.size.height).toBeLessThan(30);
    expect(b.selection.origin.y + b.selection.size.height).toBeLessThan(b['chat-header'].size.height);
    console.log('TYPE_TITLE ' + JSON.stringify({ scheme, title, selection: b.selection, header: b['chat-header'], window: app.window('main').state() }));
    await app.screenshot(`type-${scheme}-narrow-long-title.png`);
  });
}
