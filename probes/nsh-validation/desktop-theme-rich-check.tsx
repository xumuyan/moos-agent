// Known-blocked diagnostic, deliberately separate from safe-area acceptance.
import { expect, open, test } from 'nsh/test';
for (const scheme of ['light', 'dark'] as const) {
  test(`native rich long markdown/path stays in virtual list ${scheme}`, async () => {
    const app = await open('./ThemeRich.tsx', { width:1240,height:820,colorScheme:scheme });
    await app.waitFor('text:项目 主题验证 A');
    await app.type('id:prompt', '合成 Markdown'); await app.press('id:send');
    await app.waitUntil(() => app.texts().some(t => t.includes('3 事件')));
    expect(app.count('id:message')).toBeGreaterThan(0);
    // Variable-height markdown is measured as it enters the virtual viewport.
    for (let page = 0; page < 12 && !app.shows('text:tool_end · read · 错误'); page++) {
      await app.scroll('id:messages', 400); await app.wait(80);
    }
    await app.waitFor('text:tool_end · read · 错误'); await app.setViewport(680,720);
    await app.scroll('id:messages', 200); await app.press('id:stop');
    await app.waitUntil(() => app.texts().some(t => t.includes('cancelled · 已排空')));
  });
}
