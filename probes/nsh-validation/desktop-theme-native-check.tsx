import { expect, open, test } from 'nsh/test';
import { artAvailable } from './desktop-theme-art';
// Real macOS development-host windows with an explicit call fixture, not host.handlers (unsupported natively in 0.5.0).
test('native theme columns, tool status, stop and selection', async () => {
  const app = await open('./ThemeNative.tsx', { width: 1240, height: 820 });
  await app.waitFor('text:项目 主题验证 A'); await app.type('id:prompt', '原生视图验证'); await app.press('id:send');
  await app.waitFor('text:tool_end · read · 错误'); expect(app.enabled('id:send')).toBe(false);
  await app.press('id:toggle-details'); await app.waitFor('id:details-panel');
  await app.press('id:stop'); await app.waitUntil(() => app.texts().some(t => t.includes('cancelled · 已排空')));
  expect(app.enabled('id:stop')).toBe(false);
  await app.press('id:project-主题验证 B'); await app.waitFor('text:项目 主题验证 B');
  expect(app.shows('text:tool_end · read · 错误')).toBe(false);
  await app.press('id:session-第二会话'); await app.waitFor('text:● 第二会话');
});
test('native theme narrow window and Host failure disable submission', async () => {
  const app = await open('./ThemeError.tsx', { width: 680, height: 720 });
  await app.waitFor('text:项目 主题验证 A'); await app.press('id:toggle-navigation'); expect(app.shows('id:sidebar')).toBe(false);
  await app.type('id:prompt', '错误态'); await app.press('id:send');
  await app.waitUntil(() => app.texts().some(t => t.includes('desktop_unavailable')));
  expect(app.enabled('id:send')).toBe(false); expect(app.texts().join(' ').includes('private-secret')).toBe(false);
});
test('native theme 1000 public rows recycle and stop after drain', async () => {
  const app = await open('./ThemeLong.tsx', { width: 1240, height: 820 });
  await app.waitFor('text:项目 主题验证 A'); await app.type('id:prompt', 'long'); await app.press('id:send');
  await app.waitUntil(() => app.texts().some(t => t.includes('1000 事件')), { timeout: 15000 });
  expect(app.count('id:message')).toBeGreaterThan(0); expect(app.count('id:message')).toBeLessThan(100);
  await app.scroll('id:messages', 1200); expect(app.count('id:message')).toBeLessThan(100);
  await app.press('id:stop'); await app.waitUntil(() => app.texts().some(t => t.includes('cancelled · 已排空')));
});

test('native optional art layers, unavailable controls and dark appearance keep genuine controls usable', async () => {
  const app = await open('./ThemeNative.tsx', { width: 1240, height: 820, colorScheme: 'dark' });
  await app.waitFor('text:项目 主题验证 A');
  expect(app.enabled('id:search-unavailable')).toBe(false);
  expect(app.enabled('id:settings-unavailable')).toBe(false);
  expect(app.shows('id:palace-background')).toBe(artAvailable);
  expect(app.shows('id:character-left')).toBe(artAvailable);
  expect(app.shows('id:character-right')).toBe(artAvailable);
  expect(app.shows('id:bottom-trim')).toBe(true);
  await app.press('id:create-session'); await app.waitFor('text:新会话 3');
  await app.type('id:prompt', '装饰层不能拦截输入'); await app.press('id:send');
  await app.waitFor('text:tool_end · read · 错误');
  expect(app.shows('id:bottom-trim')).toBe(false);
  await app.press('id:stop');
  await app.waitUntil(() => app.texts().some(t => t.includes('cancelled · 已排空')));
});
