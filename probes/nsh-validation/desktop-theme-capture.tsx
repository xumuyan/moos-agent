import { open, test } from 'nsh/test';
// This test is selected only by the --capture native runner. Never label headless output as a screenshot.
test('theme native capture scene (synthetic public responses)', async () => {
  const app = await open('./ThemeNative.tsx', { width: 1240, height: 820 });
  await app.waitFor('text:项目 主题验证 A'); await app.type('id:prompt', '读取独立工作区中的测试文件'); await app.press('id:send');
  await app.waitFor('text:读取 · 失败'); await app.press('id:stop');
  await app.waitUntil(() => app.texts().some(t => t.includes('cancelled · 已排空')));
  await app.screenshot('collapsed.png'); await app.press('id:toggle-details'); await app.waitFor('id:details-panel'); await app.screenshot('expanded.png');
  await app.setViewport(680, 720); await app.waitFor('id:toggle-navigation'); await app.press('id:toggle-navigation'); await app.screenshot('narrow.png');
});

test('theme native dark and idle capture scenes (synthetic, not production)', async () => {
  const app = await open('./ThemeNative.tsx', { width: 1240, height: 820, colorScheme: 'dark' });
  await app.waitFor('text:项目 主题验证 A');
  await app.screenshot('dark-idle.png');
  await app.type('id:prompt', '深色主题公开事件预览'); await app.press('id:send');
  await app.waitFor('text:读取 · 失败'); await app.press('id:stop');
  await app.waitUntil(() => app.texts().some(t => t.includes('cancelled · 已排空')));
  await app.screenshot('dark-chat.png');
});
