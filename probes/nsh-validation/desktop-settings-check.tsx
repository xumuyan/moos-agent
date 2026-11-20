import { expect, open, test, type App } from 'nsh/test';

const trigger = 'id:settings-trigger', content = 'id:settings-content';
const statistics = 'id:composer-statistics', characters = 'id:settings-characters';
const close = (app: App) => app.waitUntil(() => !app.shows(content));
const schemeText = (app: App) => app.texts().find(text => text.startsWith('SETTINGS_SCHEME '));

for (const [scheme, width, height] of [['light', 1240, 820], ['dark', 680, 720]] as const) {
  test(`settings ${scheme} ${width}: display options and draft survive closing`, async () => {
    const app = await open('./ThemeGeometry.tsx', { width, height, colorScheme: scheme, reducedMotion: true, locale: 'zh-CN' });
    await app.waitFor('text:项目 主题验证 A');
    await app.waitFor(statistics);
    const artwork = app.shows('id:palace-background');
    expect(app.shows('id:character-left')).toBe(artwork);
    await app.type('id:prompt', '保留设置前的草稿');
    await app.press(trigger);
    await app.waitFor(content);
    await app.waitFor('id:settings-default-model');
    expect(app.texts().filter(text => text === '本地夹具 · 标准')).toHaveLength(2);
    await app.waitFor('text:显示设置即时生效，仅在本次运行中保留。');
    expect(app.enabled(characters)).toBe(artwork);
    await app.keyboard.press('enter');
    expect(app.shows(content)).toBe(true);
    expect(app.shows('id:icon-stop')).toBe(false);
    const geometry = () => JSON.parse(app.texts().find(t => t.startsWith('STYLE_GEOMETRY '))!.slice('STYLE_GEOMETRY '.length));
    await app.waitUntil(() => !!geometry()['settings-content']);
    const bounds = geometry()['settings-content'];
    expect(bounds.size.width).toBeGreaterThan(490);
    expect(bounds.size.width).toBeLessThan(width - 30);
    expect(bounds.size.height).toBeGreaterThan(420);
    expect(bounds.size.height).toBeLessThan(height - 50);
    expect(app.window('main').state()!.scaleFactor).toBe(1);
    console.log('SETTINGS_GEOMETRY ' + JSON.stringify({ scheme, width, height, artwork, bounds }));
    await app.screenshot(`settings-${scheme}-${width}-open.png`);

    const other = scheme === 'light' ? 'dark' : 'light';
    await app.press(`id:settings-appearance-${other}`);
    await app.waitUntil(() => schemeText(app) === `SETTINGS_SCHEME ${other}`);
    await app.setColorScheme(other);
    await app.setColorScheme(scheme);
    expect(schemeText(app)).toBe(`SETTINGS_SCHEME ${other}`);
    await app.screenshot(`settings-${scheme}-${width}-switched.png`);
    if (artwork) await app.press(characters);
    await app.press('id:settings-statistics');
    await app.keyboard.press('escape');
    await close(app);
    expect(app.shows(statistics)).toBe(false);
    expect(app.shows('id:character-left')).toBe(false);
    expect(app.shows('id:palace-background')).toBe(artwork);
    expect(app.value('id:prompt')).toBe('保留设置前的草稿');
    await app.screenshot(`settings-${scheme}-${width}-hidden.png`);

    await app.press(trigger);
    await app.waitFor(content);
    await app.press('id:settings-appearance-system');
    await app.waitUntil(() => schemeText(app) === `SETTINGS_SCHEME ${scheme}`);
    await app.setColorScheme(other);
    await app.waitUntil(() => schemeText(app) === `SETTINGS_SCHEME ${other}`);
    await app.setColorScheme(scheme);
    await app.waitUntil(() => schemeText(app) === `SETTINGS_SCHEME ${scheme}`);
    if (artwork) await app.press(characters);
    await app.press('id:settings-statistics');
    await app.press('id:settings-close');
    await close(app);
    expect(app.shows(statistics)).toBe(true);
    expect(app.shows('id:character-left')).toBe(artwork);
    expect(app.value('id:prompt')).toBe('保留设置前的草稿');
    expect(app.shows('id:icon-stop')).toBe(false);
    expect(app.storage()).toEqual({});
  });
}

test('settings: a hidden statistics row still accumulates drained tasks', async () => {
  const app = await open('./ThemeStatistics.tsx', { width: 680, height: 720, colorScheme: 'light', reducedMotion: true, locale: 'zh-CN' });
  await app.waitFor('text:项目 主题验证 A');
  await app.press(trigger);
  await app.press('id:settings-statistics');
  await app.press('id:settings-close');
  await close(app);
  expect(app.shows(statistics)).toBe(false);
  await app.type('id:prompt', '关闭统计显示后执行');
  await app.press('id:primary-action');
  await app.waitFor('text:合成统计样本');
  await app.waitUntil(() => app.shows('id:icon-send'));
  expect(app.shows(statistics)).toBe(false);
  await app.press(trigger);
  await app.press('id:settings-statistics');
  await app.press('id:settings-close');
  await close(app);
  await app.waitFor('text:1 轮 2 步');
  await app.waitFor('text:缓存命中 84.4%');
  await app.waitFor('text:上下文 86,416 / 128,000');
});
