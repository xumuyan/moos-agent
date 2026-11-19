import { expect, open, test } from 'nsh/test';
import { desktopLayout, desktopTheme, frameTopSegments, styleLayout, sidebarCorners } from './desktop-theme';
import { fixture } from './desktop-theme-fixture';
test('theme geometry keeps reference dimensions and collapses narrow panels', () => {
  expect(desktopTheme.sidebarWidth).toBe(280); expect(desktopTheme.headerHeight).toBe(75);
  expect(desktopLayout(1240, false).inset).toBe(120);
  expect(desktopLayout(1240, true).right).toBe(true);
  expect(desktopLayout(680, true).right).toBe(false);
  expect(desktopLayout(680, true).compact).toBe(true);
});
test('theme three columns, tool error, stop, project and session isolation', async () => {
  const app = await open('./DesktopApp.tsx', { width: 1240, height: 820, host: { handlers: fixture() } });
  await app.waitFor('text:项目 主题验证 A');
  expect(app.enabled('id:primary-action')).toBe(false); expect(app.shows('id:icon-stop')).toBe(false);
  expect(app.shows('id:details-panel')).toBe(false);
  await app.press('id:toggle-details'); await app.waitFor('id:details-panel');
  await app.type('id:prompt', '测试真实发送入口'); await app.press('id:primary-action');
  await app.waitFor('text:读取 · 失败'); expect(app.shows('id:icon-send')).toBe(false);
  await app.press('id:session-第二会话'); await app.waitFor('id:empty-state');
  expect(app.shows('text:读取 · 失败')).toBe(false);
  await app.press('id:session-独立会话'); await app.waitFor('text:读取 · 失败');
  await app.press('id:primary-action'); await app.waitUntil(() => app.texts().some(t => t.includes('cancelled · 已排空')));
  expect(app.shows('id:icon-stop')).toBe(false);
  await app.press('id:project-主题验证 B'); await app.waitFor('text:项目 主题验证 B');
  expect(app.shows('text:读取 · 失败')).toBe(false);
  expect(app.host.calls().filter(c => c.name === 'tasks.submit')).toHaveLength(1);
});
test('legacy Host without catalog can submit without a model ID', async () => {
  const handlers = { ...fixture(), 'projects.list': () => ({ version: 1, id: 'legacy', ok: true,
    result: { projects: [{ id: 'a', name: '旧版 Host' }] } }) };
  const app = await open('./DesktopApp.tsx', { host: { handlers } });
  await app.waitFor('text:项目 旧版 Host');
  expect(app.shows('text:模型不可选')).toBe(true);
  expect(app.enabled('id:model-trigger')).toBe(false);
  await app.type('id:prompt', '旧版提交'); await app.press('id:primary-action');
  await app.waitFor('text:读取 · 失败');
  const submit = app.host.calls().filter(c => c.name === 'tasks.submit');
  expect(submit).toHaveLength(1);
  expect(Object.hasOwn(submit[0].data as object, 'modelId')).toBe(false);
});
test('invalid catalog fails closed and cannot submit', async () => {
  const handlers = { ...fixture(), 'projects.list': () => ({ version: 1, id: 'invalid', ok: true,
    result: { projects: [{ id: 'a', name: '测试' }], models: { defaultId: 'unknown', options: [{ id: 'fixture', label: '标准' }] } } }) };
  const app = await open('./DesktopApp.tsx', { host: { handlers } });
  await app.waitUntil(() => app.texts().some(t => t.includes('invalid_response')));
  await app.type('id:prompt', '不可提交'); await app.submit('id:prompt');
  expect(app.enabled('id:model-trigger')).toBe(false);
  expect(app.enabled('id:primary-action')).toBe(false);
  expect(app.host.calls().filter(c => c.name === 'tasks.submit')).toHaveLength(0);
});
test('theme narrow navigation, errors and no false completion', async () => {
  const app = await open('./DesktopApp.tsx', { width: 680, height: 720, host: { handlers: fixture({ error: true }) } });
  await app.waitFor('text:项目 主题验证 A');
  expect(app.enabled('id:toggle-details')).toBe(false);
  await app.press('id:toggle-navigation'); expect(app.shows('id:sidebar')).toBe(false);
  await app.type('id:prompt', '错误态'); await app.press('id:primary-action');
  await app.waitUntil(() => app.texts().some(t => t.includes('desktop_unavailable')));
  expect(app.enabled('id:primary-action')).toBe(false); expect(app.texts().join(' ').includes('private-secret')).toBe(false);
  await app.type('id:prompt', '不能通过Return重放'); await app.keyboard.press('Enter');
  expect(app.host.calls().filter(c => c.name === 'tasks.submit')).toHaveLength(1);
});
test('theme 1000 public tool rows remain virtualized while polling and stopping', async () => {
  const app = await open('./DesktopApp.tsx', { width: 1240, height: 820, host: { handlers: fixture({ long: true }) } });
  await app.waitFor('text:项目 主题验证 A'); await app.type('id:prompt', 'long'); await app.press('id:primary-action');
  await app.waitUntil(() => app.texts().some(t => t.includes('1000 事件')));
  expect(app.count('id:message')).toBeGreaterThan(0); expect(app.count('id:message')).toBeLessThan(100);
  await app.scroll('id:messages', -1200); expect(app.count('id:message')).toBeLessThan(100);
  await app.press('id:primary-action'); await app.waitUntil(() => app.texts().some(t => t.includes('cancelled · 已排空')));
});
test('theme no projects leaves a genuine empty disabled composer', async () => {
  const app = await open('./DesktopApp.tsx', { host: { handlers: fixture({ empty: true }) } });
  await app.waitFor('id:empty-state'); await app.type('id:prompt', 'empty');
  expect(app.enabled('id:primary-action')).toBe(false); expect(app.enabled('id:create-session')).toBe(false);
});
test('skin-only fallback is honest, unavailable entries disabled, controls preserve action contract', async () => {
  const app = await open('./DesktopApp.tsx', { width: 1240, height: 820, host: { handlers: fixture() } });
  await app.waitFor('text:项目 主题验证 A');
  expect(app.enabled('id:search-unavailable')).toBe(false);
  expect(app.enabled('id:settings-unavailable')).toBe(false);
  expect(app.shows('text:美术未加载：纯样式回归，不是完整皮肤预览')).toBe(true);
  expect(app.shows('id:palace-background')).toBe(false);
  expect(app.shows('id:bottom-trim')).toBe(true);
  await app.press('id:create-session'); await app.waitFor('text:新会话 3');
  expect(app.host.calls().filter(c => c.name === 'sessions.create')).toHaveLength(1);
  await app.type('id:prompt', '真实入口'); await app.press('id:primary-action');
  await app.waitFor('text:读取 · 失败');
  expect(app.shows('id:bottom-trim')).toBe(false);
});
test('dark system appearance preserves composer contrast and real disabled state', async () => {
  const app = await open('./DesktopApp.tsx', { width: 1240, height: 820, colorScheme: 'dark', host: { handlers: fixture() } });
  await app.waitFor('text:项目 主题验证 A');
  expect(app.shows('id:composer')).toBe(true); expect(app.enabled('id:primary-action')).toBe(false);
  expect(app.spanStyle('text:从一个真实任务开始').color).toBe('#e5eaf6ff');
});

test('style safe envelopes reserve trim and frame without deleting source art', () => {
  for (const active of [false, true]) for (const artwork of [false, true]) {
    const s = styleLayout(active, artwork);
    expect(s.headerTop).toBeGreaterThanOrEqual(s.trim);
    expect(s.composerTop).toBeGreaterThan(s.frameTop);
    expect(s.composerBottom).toBeGreaterThan(s.frameBottom);
    expect(s.previewHeight).toBeGreaterThanOrEqual(32);
    expect(s.bottom).toBe(artwork && !active ? 60 : 8);
  }
  expect(sidebarCorners.map(c => [c.scaleX, c.scaleY])).toEqual([[-1,1],[1,1],[1,-1],[-1,-1]]);
  for (const width of [699,700,701,759,760,761,1099,1100,1101,1199,1200,1201]) {
    expect(desktopLayout(width, true).right).toBe(width >= 1100);
    expect(desktopLayout(width, true).compact).toBe(width < 760);
  }
});

test('composer top slices preserve the centered bow aspect and meet edge to edge', () => {
  const scale = 72 / 170;
  for (const width of [484, 748, 988]) {
    const [left, center, right] = frameTopSegments(120, 1680, 54, width - 54, scale, 360);
    expect([left[0], left[1], center[0], center[1], right[0], right[1]]).toEqual([120, 720, 720, 1080, 1080, 1680]);
    expect([left[2], left[3], right[2], right[3]]).toEqual([54, center[2], center[3], width - 54]);
    expect(Math.abs((center[3] - center[2]) / 360 - scale)).toBeLessThan(.000001);
    expect((center[2] + center[3]) / 2).toBe(width / 2);
  }
});

import { assertStyleBounds } from './desktop-style-assert';
for (const scheme of ['light', 'dark'] as const) for (const width of [1240, 680]) {
  test(`headless actual safe bounds ${scheme} ${width} fallback`, async () => {
    const height = width === 1240 ? 820 : 720;
    const app = await open('./ThemeGeometry.tsx', { width, height, colorScheme: scheme });
    await app.waitFor('text:项目 主题验证 A'); await assertStyleBounds(app, false, height);
    await app.type('id:prompt', '短文'); await app.press('id:primary-action');
    await app.waitFor('text:读取 · 失败'); await assertStyleBounds(app, true, height);
    await app.press('id:primary-action'); await app.waitUntil(() => app.texts().some(t => t.includes('cancelled · 已排空')));
  });
}
