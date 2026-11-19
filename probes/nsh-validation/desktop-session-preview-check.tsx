import { expect, open, test } from 'nsh/test';

const first = 'text:独立会话', second = 'text:第二会话';
const card = (id: string) => `id:session-preview-${id}`;
for (const colorScheme of ['light', 'dark'] as const) {
  test(`per-session native hover card (${colorScheme})`, async () => {
    const app = await open('./ThemeGeometry.tsx', { width: 1240, height: 820, colorScheme, reducedMotion: true });
    await app.waitFor('id:session-label-other-a');
    for (const [width, height] of [[1240, 820], [680, 720]]) {
      await app.setViewport(width, height);
      const geometry = () => JSON.parse(app.texts().find(t => t.startsWith('STYLE_GEOMETRY '))!.slice('STYLE_GEOMETRY '.length));
      await app.waitUntil(() => geometry().sidebar?.size.width === (width === 1240 ? 280 : 184) && !!geometry()['session-row-other-a']);
      expect(app.window('main').state()!.scaleFactor).toBe(1);
      const label = `session-preview-${colorScheme}-${width}`;
      const bounds = geometry();
      const row = 'id:session-label-other-a';
      await app.hover('id:empty-state');
      await app.screenshot(`${label}-rest.png`);
      await app.hover(row);
      expect(app.shows(card('other-a'))).toBe(false);
      await app.waitFor(card('other-a'));
      expect(app.shows(`${card('other-a')} >> ${second}`)).toBe(true);
      expect(app.shows(`${card('other-a')} >> text:2 小时前`)).toBe(true);
      expect(app.shows('text:示例工作区/很长的目录用于验证换行/NSH候选版')).toBe(true);
      expect(app.shows('text:进行中')).toBe(false);
      expect(app.count(first)).toBeGreaterThan(1); // current title has not changed
      await app.screenshot(`${label}-hover.png`);
      await app.hover('id:empty-state');
      await app.waitUntil(() => !app.shows(card('other-a')));
      await app.screenshot(`${label}-leave.png`);
      for (const key of ['sessions', 'project-group-a', 'session-row-s-a', 'session-row-other-a']) expect(geometry()[key]).toEqual(bounds[key]);
      console.log('SESSION_PREVIEW_GEOMETRY ' + JSON.stringify({ label, width, height, bounds }));
    }
    await app.type('id:prompt', '合成任务');
    await app.press('id:primary-action');
    await app.waitFor('id:session-activity-s-a');
    await app.waitFor('text:running · 读取事件中 · 3 事件');
    await app.hover('id:session-label-other-a');
    await app.waitFor(card('other-a'));
    await app.hover('id:session-label-s-a');
    await app.waitFor(card('s-a'));
    expect(app.shows(`${card('s-a')} >> text:进行中`)).toBe(true);
    expect(app.shows(`${card('s-a')} >> text:1 分钟前`)).toBe(true);
    await app.screenshot(`session-preview-${colorScheme}-running.png`);
    await app.hover('id:session-label-other-a');
    await app.waitFor(card('other-a'));
    expect(app.shows(card('s-a'))).toBe(false);
    expect(app.shows('text:进行中')).toBe(false);
    await app.keyboard.press('escape');
    await app.waitUntil(() => !app.shows(card('other-a')));
    await app.press('id:primary-action');
    await app.waitUntil(() => !app.shows('id:session-activity-s-a'));
    await app.hover('id:session-label-s-a');
    await app.waitFor(`${card('s-a')} >> text:已停止`);
    await app.press('id:session-label-other-a');
    await app.waitUntil(() => !app.shows(card('s-a')) && !app.shows(card('other-a')));
    expect(app.count(second)).toBeGreaterThan(1);
    await app.press('id:project-主题验证 B');
    await app.waitFor('id:session-label-s-b');
    await app.hover('id:session-label-s-b');
    await app.waitFor(`${card('s-b')} >> text:示例工作区/项目B`);
    expect(app.shows(card('s-a'))).toBe(false);
    await app.press('id:toggle-navigation');
    await app.waitUntil(() => !app.shows(card('s-b')) && !app.shows('id:sidebar'));
  });
}
