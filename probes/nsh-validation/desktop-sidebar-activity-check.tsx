import { expect, open, test, type App } from 'nsh/test';
import { sidebarTree } from './desktop-sidebar-tree';

async function assertStatusGutter(app: App) {
  const marker = 'STYLE_GEOMETRY ';
  const read = () => JSON.parse(app.texts().find(t => t.startsWith(marker))?.slice(marker.length) ?? '{}');
  await app.waitUntil(() => !!read()['session-activity-s-a'] && !!read()['session-row-s-a']);
  const bounds = read();
  const jewel = bounds['session-activity-s-a'];
  const row = bounds['session-row-s-a'];
  expect(jewel.size.width).toBe(12);
  expect(jewel.size.height).toBe(12);
  expect(jewel.origin.y + jewel.size.height / 2).toBe(sidebarTree.sessionHeight / 2);
  expect(jewel.origin.x + jewel.size.width).toBeLessThanOrEqual(row.origin.x);
}

for (const scheme of ['light', 'dark'] as const) {
  test(`sidebar ${scheme}: idle, working and unselected`, async () => {
    const reducedMotion = scheme === 'dark';
    const app = await open('./ThemeGeometry.tsx', { width: 1240, height: 820, colorScheme: scheme, locale: 'zh-CN', reducedMotion });
    const activity = 'id:session-activity-s-a';
    await app.waitFor('id:session-label-s-a');
    await app.waitFor('id:branch-stem-other-a');
    expect(app.shows(activity)).toBe(false);
    await app.screenshot(`tree-${scheme}-idle.png`);
    await app.type('id:prompt', '合成运行状态'); await app.press('id:primary-action');
    await app.waitFor('text:读取 · 失败'); await app.waitFor(activity);
    expect(app.shows('id:session-activity-other-a')).toBe(false);
    await assertStatusGutter(app);
    await app.screenshot(`tree-${scheme}-working.png`);
    await new Promise(resolve => setTimeout(resolve, 240));
    await app.screenshot(`tree-${scheme}-working-next.png`);
    await app.press('id:session-第二会话'); await app.waitFor('id:empty-state');
    expect(app.shows(activity)).toBe(true); // selection is independent of task ownership
    expect(app.shows('id:session-activity-other-a')).toBe(false);
    await app.screenshot(`tree-${scheme}-unselected.png`);
    await app.press('id:session-独立会话'); await app.waitFor('text:读取 · 失败');
    await app.setViewport(680,720);
    await app.waitFor('id:toggle-navigation');
    await app.waitFor('id:session-label-s-a');
    expect(app.shows(activity)).toBe(true);
    await assertStatusGutter(app);
    await app.screenshot(`tree-${scheme}-narrow-working.png`);
    await app.press('id:primary-action');
    await app.waitUntil(() => app.texts().some(t => t.includes('cancelled · 已排空')));
    expect(app.shows(activity)).toBe(false);
    await app.screenshot(`tree-${scheme}-narrow.png`);
  });
}
