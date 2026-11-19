// AppKit development host only; synthetic messages, no production window.
import { expect, open, test, type App } from 'nsh/test';
import { artAvailable } from './desktop-theme-art';

function readout(app: App, prefix: string) {
  return JSON.parse(app.texts().find(t => t.startsWith(prefix))!.slice(prefix.length));
}

async function checkFrame(app: App, width: number, height: number, name: string, active: boolean, sidebar: boolean) {
  await app.waitUntil(() => app.texts().some(t => t.startsWith('STYLE_GEOMETRY ') && t.includes('window-drag-region')));
  const state = app.window('main').state()!;
  const chrome = readout(app, 'WINDOW_CHROME ');
  const bounds = readout(app, 'STYLE_GEOMETRY ');
  const drag = bounds['window-drag-region'];
  const header = bounds['chat-header'];
  expect(state.bounds).toEqual(state.contentBounds);
  expect(state.contentBounds.size).toEqual({ width, height });
  expect(chrome.height).toBe(32);
  expect(chrome.left).toBeGreaterThan(0); // native traffic-light reservation, not simulated dots
  expect(drag.origin.y).toBe(0);
  expect(drag.origin.x).toBeGreaterThanOrEqual(chrome.left + 8);
  expect(drag.size.height).toBe(chrome.height);
  expect(drag.size.width).toBeGreaterThan(width / 2);
  expect(drag.origin.x + drag.size.width).toBeLessThanOrEqual(width - chrome.right - 8);
  const trim = artAvailable ? (active ? 76 : 48) : 0;
  expect(header.origin.y).toBe(Math.max(trim, chrome.height) + 8);
  expect(bounds.selection.origin.y + bounds.selection.size.height).toBeLessThan(header.size.height);
  expect(app.shows('id:sidebar')).toBe(sidebar);
  if (sidebar) expect(bounds['sidebar-brand'].origin.y).toBeGreaterThan(chrome.height);
  console.log('CHROME_FRAME ' + JSON.stringify({ name, state, chrome, drag, header, selection: bounds.selection, active, sidebar, artwork: artAvailable }));
  await app.screenshot(`${name}.png`);
}

for (const scheme of ['light', 'dark'] as const) {
  test(`integrated macOS window ${scheme}: full content frame and independent controls`, async () => {
    const app = await open('./ThemeGeometry.tsx', { width: 1240, height: 820, colorScheme: scheme, locale: 'zh-CN', reducedMotion: true });
    await app.waitFor('text:项目 主题验证 A');
    await checkFrame(app, 1240, 820, `chrome-${scheme}-wide-idle`, false, true);
    await app.press('id:toggle-details'); await app.waitFor('id:details-panel');
    await app.press('id:toggle-details'); expect(app.shows('id:details-panel')).toBe(false);
    await app.type('id:prompt', '窗口背景测试（合成）'); await app.press('id:primary-action');
    await app.waitFor('text:读取 · 失败');
    await checkFrame(app, 1240, 820, `chrome-${scheme}-wide-chat`, true, true);
    await app.press('id:primary-action'); await app.waitUntil(() => app.texts().some(t => t.includes('cancelled · 已排空')));
    await app.setViewport(680, 720); await app.waitFor('id:toggle-navigation');
    await app.press('id:toggle-navigation');
    await checkFrame(app, 680, 720, `chrome-${scheme}-narrow-chat`, true, false);
    await app.press('id:toggle-navigation');
    await app.press('id:project-主题验证 B'); await app.waitFor('text:项目 主题验证 B');
    await checkFrame(app, 680, 720, `chrome-${scheme}-narrow-idle`, false, true);
    const window = app.window('main');
    await window.pressClose();
    await app.waitFor('text:CHROME_CLOSE closeButton');
    expect(window.state()?.visible).toBe(true);
    console.log('CHROME_CLOSE_REQUEST ' + scheme + ' closeButton (fixture prevents closing the test host)');
  });
}
