import { expect, open, test, type App } from 'nsh/test';
import { artAvailable } from './desktop-theme-art';

const menu = ['plugins', 'background', 'more'];
const workspace = ['search', 'workspace-options', 'add-project'];
function geometry(app: App) {
  const prefix = 'STYLE_GEOMETRY ';
  return JSON.parse(app.texts().find(t => t.startsWith(prefix))!.slice(prefix.length));
}
async function assertSidebar(app: App, scheme: string, width: number) {
  await app.waitUntil(() => {
    const g = geometry(app);
    return g.sidebar?.size.width === (width < 760 ? 184 : 280) && !!g['icon-add-project'] && !!g['nav-label-more'];
  });
  const g = geometry(app), toggle = g['toggle-navigation'], drag = g['window-drag-region'];
  expect(toggle.size).toEqual({ width: 32, height: 32 });
  expect(toggle.origin.x + toggle.size.width).toBeLessThanOrEqual(drag.origin.x);
  expect(toggle.origin.x + toggle.size.width).toBeLessThan(g.sidebar.size.width);
  for (const id of menu) {
    const icon = g[`icon-nav-${id}`], row = g[`nav-${id}`], label = g[`nav-label-${id}`];
    expect(icon.size).toEqual({ width: 16, height: 16 });
    expect(icon.origin.x).toBe(4);
    expect(icon.origin.y + 8).toBe(row.size.height / 2);
    expect(label.origin.x).toBe(icon.origin.x + 16 + 6);
    expect(app.enabled(`id:nav-${id}-unavailable`)).toBe(false);
  }
  for (const id of workspace) {
    expect(g[id].size).toEqual({ width: 32, height: 32 });
    expect(g[`icon-${id}`].origin).toEqual({ x: 8, y: 8 });
    expect(app.enabled(`id:${id}-unavailable`)).toBe(false);
  }
  expect(g['workspace-options'].origin.x - g.search.origin.x).toBe(32);
  expect(g['add-project'].origin.x - g['workspace-options'].origin.x).toBe(32);
  expect(app.enabled('id:settings-unavailable')).toBe(false);
  expect(app.shows('id:icon-settings')).toBe(true);
  expect(app.shows('id:icon-project-a')).toBe(!artAvailable);
  console.log('ICON_GEOMETRY ' + JSON.stringify({ scheme, width, bounds: g }));
}
for (const scheme of ['light', 'dark'] as const) {
  test(`DSH vector icons, sidebar alignment and actions ${scheme}`, async () => {
    const app = await open('./ThemeGeometry.tsx', { width: 1240, height: 820, colorScheme: scheme, locale: 'zh-CN', reducedMotion: true });
    await app.waitFor('text:项目 主题验证 A');
    await assertSidebar(app, scheme, 1240);
    await app.screenshot(`icons-${scheme}-wide-idle.png`);
    await app.press('id:toggle-navigation'); expect(app.shows('id:sidebar')).toBe(false);
    await app.press('id:toggle-navigation'); await app.waitFor('id:sidebar');
    await app.press('id:toggle-details'); await app.waitFor('id:details-panel');
    await app.press('id:toggle-details'); expect(app.shows('id:details-panel')).toBe(false);
    await app.press('id:create-session'); await app.waitFor('text:新会话 3');
    await app.type('id:prompt', '图标回归（合成）'); expect(app.enabled('id:send')).toBe(true);
    await app.press('id:send'); await app.waitFor('text:读取 · 失败'); await app.waitFor('text:写入 · 完成');
    expect(app.count('id:icon-tool')).toBe(4);
    expect(app.enabled('id:stop')).toBe(true);
    await app.screenshot(`icons-${scheme}-wide-chat.png`);
    await app.setViewport(680, 720); await assertSidebar(app, scheme, 680);
    expect(app.enabled('id:toggle-details')).toBe(false);
    await app.screenshot(`icons-${scheme}-narrow-chat.png`);
    await app.press('id:stop'); await app.waitUntil(() => app.texts().some(t => t.includes('cancelled · 已排空')));
    expect(app.enabled('id:stop')).toBe(false);
    await app.press('id:toggle-navigation'); expect(app.shows('id:sidebar')).toBe(false);
    await app.screenshot(`icons-${scheme}-narrow-collapsed.png`);
    await app.press('id:toggle-navigation');
    await app.press('id:project-主题验证 B'); await app.waitFor('text:项目 主题验证 B');
    expect(app.shows('id:icon-tool')).toBe(false);
  });
}
