import { expect, open, test, type App } from 'nsh/test';

function geometry(app: App) {
  const prefix = 'STYLE_GEOMETRY ';
  return JSON.parse(app.texts().find(t => t.startsWith(prefix))!.slice(prefix.length));
}

const picker = 'id:model-trigger', navigation = 'id:toggle-navigation', settings = 'id:settings-trigger';
for (const colorScheme of ['light', 'dark'] as const) {
  test(`matching native control chrome and pointer feedback (${colorScheme})`, async () => {
    const app = await open('./ThemeGeometry.tsx', { width: 1240, height: 820, colorScheme, reducedMotion: true });
    await app.waitFor('text:项目 主题验证 A');
    for (const [width, height] of [[1240, 820], [680, 720]]) {
      await app.setViewport(width, height);
      await app.waitUntil(() => geometry(app).sidebar?.size.width === (width === 1240 ? 280 : 184)
        && !!geometry(app)['sidebar-settings'] && !!geometry(app)['model-picker'] && !!geometry(app)['composer-actions']);
      expect(app.window('main').state()!.scaleFactor).toBe(1);
      const prefix = `controls-${colorScheme}-${width}`;
      const bounds = geometry(app);
      expect(app.shows('id:icon-model-down')).toBe(true);
      expect(app.shows('id:icon-model-up')).toBe(false);
      expect(app.enabled('id:settings-trigger')).toBe(true);
      await app.hover('id:empty-state');
      await app.screenshot(`${prefix}-rest.png`);
      for (const [name, target] of [['picker', picker], ['navigation', navigation], ['settings', settings]]) {
        await app.hover(target);
        await app.screenshot(`${prefix}-${name}.png`);
        expect(geometry(app)['model-picker']).toEqual(bounds['model-picker']);
        expect(geometry(app)['sidebar-settings']).toEqual(bounds['sidebar-settings']);
        expect(geometry(app)['toggle-navigation']).toEqual(bounds['toggle-navigation']);
        expect(app.enabled('id:settings-trigger')).toBe(true);
        expect(app.shows('id:model-pane-root')).toBe(false);
      }
      await app.hover('id:empty-state');
      await app.screenshot(`${prefix}-leave.png`);
      await app.press(picker);
      await app.waitFor('id:icon-model-up');
      expect(app.shows('id:icon-model-down')).toBe(false);
      expect(app.shows('id:icon-model-models')).toBe(true);
      expect(app.shows('id:icon-model-effort')).toBe(true);
      await app.screenshot(`${prefix}-open.png`);
      await app.keyboard.press('escape');
      await app.waitFor('id:icon-model-down');
      expect(app.shows('id:icon-model-up')).toBe(false);
      console.log('CONTROL_GEOMETRY ' + JSON.stringify({ colorScheme, width, height, bounds }));
    }
  });
}
