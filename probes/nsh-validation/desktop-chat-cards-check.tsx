import { expect, open, test, type App } from 'nsh/test';

function geometry(app: App) {
  return JSON.parse(app.texts().find(t => t.startsWith('STYLE_GEOMETRY '))!.slice('STYLE_GEOMETRY '.length));
}

for (const scheme of ['light', 'dark'] as const) {
  test(`chat cards ${scheme}: role alignment, public phases, and narrow recovery`, async () => {
    const app = await open('./ThemeGeometry.tsx', { width: 1240, height: 820, colorScheme: scheme, locale: 'zh-CN' });
    await app.waitFor('text:项目 主题验证 A');
    await app.type('id:prompt', '请检查这份合成样例'); await app.press('id:primary-action');
    for (const label of ['读取 · 开始', '读取 · 失败', '写入 · 开始', '写入 · 完成']) await app.waitFor(`text:${label}`);
    await app.waitUntil(() => geometry(app)['message-tool-end']?.size.height > 0);
    const b = geometry(app);
    const user = b['message-你'], assistant = b['message-PI 公开文本'], error = b['message-tool-error'];
    expect(user.origin.x).toBeGreaterThan(assistant.origin.x);
    expect(error.origin.x).toBe(assistant.origin.x);
    expect(error.size.height).toBeLessThan(assistant.size.height);
    expect(error.size.width).toBeLessThan(assistant.size.width);
    console.log('CHAT_CARDS ' + JSON.stringify({ scheme, user, assistant, error, end: b['message-tool-end'] }));
    await app.screenshot(`cards-${scheme}-wide.png`);
    await app.setViewport(680, 720); await app.press('id:toggle-navigation');
    await app.waitFor('text:写入 · 完成');
    expect(app.shows('id:sidebar')).toBe(false);
    await app.screenshot(`cards-${scheme}-narrow.png`);
    await app.press('id:primary-action');
    await app.waitUntil(() => app.texts().some(t => t.includes('cancelled · 已排空')));
    await app.press('id:toggle-navigation'); await app.press('id:session-第二会话');
    expect(app.shows('text:读取 · 失败')).toBe(false);
    await app.press('id:session-独立会话'); await app.waitFor('text:读取 · 失败');
    await app.waitFor('text:写入 · 完成');
  });
}
