// Regression for native variable-height Markdown: receipt is not proof of reachability.
import { expect, open, test } from 'nsh/test';
function metrics(app: any) {
  return JSON.parse(app.texts().find((t: string) => t.startsWith('RICH_METRICS '))!.slice('RICH_METRICS '.length));
}
for (const scheme of ['light', 'dark'] as const) for (const width of [1240, 680]) {
  test(`native rich scroll survives polling and resize ${scheme} ${width}`, async () => {
    const height = width === 1240 ? 820 : 720;
    const app = await open('./ThemeRich.tsx', { width, height, colorScheme: scheme });
    await app.waitFor('text:项目 主题验证 A');
    if (width === 680) await app.press('id:toggle-navigation');
    await app.type('id:prompt', '合成 Markdown'); await app.press('id:primary-action');
    await app.waitUntil(() => app.texts().some(t => t.includes('3 事件')));
    await app.scroll('id:messages', -4000); await app.wait(350);
    await app.waitUntil(() => metrics(app).scroll?.offset.y < 1);
    expect(app.shows('text:合成 Markdown 长文')).toBe(true);
    await app.screenshot(`${scheme}-${width}-rich-top.png`);
    // Scroll by real gestures, not a test-only jump/ref; require native content offset.
    for (let page = 0; page < 12; page++) {
      const s = metrics(app).scroll;
      if (s && s.offset.y + s.size.height >= s.contentSize.height - 1) break;
      await app.scroll('id:messages', 400); await app.wait(80);
    }
    await app.waitUntil(() => {
      const s = metrics(app).scroll;
      return s && s.contentSize.height > s.size.height && s.offset.y + s.size.height >= s.contentSize.height - 1;
    });
    await app.waitFor('text:读取 · 失败');
    const end = metrics(app).scroll.offset.y;
    await app.wait(900); // multiple status-only polls must not reset row measurement/position
    expect(Math.abs(metrics(app).scroll.offset.y - end)).toBeLessThan(1);
    await app.screenshot(`${scheme}-${width}-rich-end.png`);
    await app.setViewport(width === 1240 ? 680 : 1240, width === 1240 ? 720 : 820);
    await app.scroll('id:messages', 4000); await app.wait(350);
    await app.waitFor('text:读取 · 失败');
    await app.press('id:primary-action');
    await app.waitUntil(() => app.texts().some(t => t.includes('cancelled · 已排空')));
    await app.screenshot(`${scheme}-${width}-rich-resized.png`);
    console.log('RICH_END ' + JSON.stringify({ scheme, width, metrics: metrics(app) }));
  });
}

for (const scheme of ['light', 'dark'] as const) {
  test(`native ribbon safe text domain short and long names ${scheme}`, async () => {
    const app = await open('./ThemeNames.tsx', { width:680, height:720, colorScheme:scheme });
    await app.waitFor('text:独立会话');
    await app.screenshot(`${scheme}-narrow-long-name.png`);
    await app.press('id:project-主题验证 B');
    await app.waitFor('text:项目 主题验证 B');
    await app.screenshot(`${scheme}-narrow-short-name.png`);
    // Actual text boxes in the ordinary short-name geometry scene.
    const geometry = await open('./ThemeGeometry.tsx', { width:680, height:720, colorScheme:scheme });
    await geometry.waitUntil(() => geometry.texts().some(t => t.startsWith('STYLE_GEOMETRY ') && t.includes('project-label-a')));
    const b = JSON.parse(geometry.texts().find(t => t.startsWith('STYLE_GEOMETRY '))!.slice('STYLE_GEOMETRY '.length));
    // Sidebar184 - padding32 = ribbon/button152. Right end-cap35 + 1pt gap.
    expect(b['project-label-a'].origin.x + b['project-label-a'].size.width).toBeLessThanOrEqual(116);
    expect(b['project-label-b'].origin.x + b['project-label-b'].size.width).toBeLessThanOrEqual(116);
  });
}
