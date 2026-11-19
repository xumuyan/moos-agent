import { expect, open, test } from 'nsh/test';
for (const scheme of ['light', 'dark'] as const) {
  test(`live sidebar tree ${scheme} reference-sized synthetic content`, async () => {
    const app = await open('./ThemeGeometry.tsx', { width: 1920, height: 988, colorScheme: scheme, locale: 'zh-CN', reducedMotion: true });
    await app.waitFor('text:项目 主题验证 A');
    await app.type('id:prompt', '【合成参考】侧栏透景，不读取用户聊天');
    await app.press('id:send'); await app.waitFor('text:tool_end · read · 错误');
    await app.press('id:stop');
    await app.waitUntil(() => app.texts().some(t => t.includes('cancelled · 已排空')));
    const state = app.window('main').state();
    expect(state!.contentBounds.size.width).toBe(1920);
    expect(state!.contentBounds.size.height).toBe(988);
    console.log('LIVE_SIDEBAR_FRAME ' + JSON.stringify({ scheme, state, synthetic: true }));
    await checkTree(app);
    await app.screenshot(`live-${scheme}-1920.png`);
    await app.setViewport(680,720); await app.waitFor('id:toggle-navigation');
    await checkTree(app);
    await app.screenshot(`live-${scheme}-680.png`);
    await app.press('id:session-第二会话'); await app.waitFor('id:empty-state');
    await app.press('id:session-独立会话'); await app.waitFor('text:tool_end · read · 错误');
    await app.press('id:create-session'); await app.waitFor('text:新会话 3');
    await app.press('id:project-主题验证 B'); await app.waitFor('text:项目 主题验证 B');
    expect(app.shows('text:新会话 3')).toBe(false);
    expect(app.shows('text:tool_end · read · 错误')).toBe(false);
    await app.screenshot(`live-${scheme}-680-project-b.png`);
  });
}
async function checkTree(app: any) {
  await app.waitUntil(() => app.texts().some((t: string) => t.startsWith('STYLE_GEOMETRY ') && t.includes('workspace-heading') && t.includes('sessions')));
  const b = JSON.parse(app.texts().find((t: string) => t.startsWith('STYLE_GEOMETRY ')).slice('STYLE_GEOMETRY '.length));
  const bottom = (v: any) => v.origin.y + v.size.height;
  expect(b['new-session-frame'].size.height).toBe(48);
  expect(b['new-session-frame'].origin.y - bottom(b['sidebar-brand'])).toBe(8);
  expect(b['sidebar-navigation'].origin.y).toBeGreaterThanOrEqual(bottom(b['new-session-frame']));
  expect(b['sidebar-navigation'].size.height).toBe(114);
  expect(b['workspace-heading'].origin.y).toBeGreaterThanOrEqual(bottom(b['sidebar-navigation']));
  expect(b.sessions.origin.y).toBe(54); // nested in selected project's group, not a separate sidebar panel
  expect(b['project-group-a'].size.height).toBe(126);
  expect(b['project-group-b'].size.height).toBe(54);
  for (const id of ['plugins','background','more']) expect(app.enabled(`id:nav-${id}-unavailable`)).toBe(false);
  for (const id of ['search','settings','workspace-options','add-project']) expect(app.enabled(`id:${id}-unavailable`)).toBe(false);
  expect(app.shows('id:sidebar-mascot')).toBe(false); // source skin hides mascot when a tree is present
  expect(app.enabled('id:settings-unavailable')).toBe(false);
  const footer = b['sidebar-footer'], settings = b['sidebar-settings'];
  const swag = Math.max(54, Math.min(94, footer.size.width * .2575));
  expect(Math.abs(footer.size.height - (swag + 82))).toBeLessThan(1);
  expect(Math.abs(bottom(footer) - b.sidebar.size.height)).toBeLessThan(1); // no duplicate outer bottom padding
  expect(Math.abs(settings.origin.y - (swag + 2))).toBeLessThan(1);
  expect(settings.size.height).toBe(36);
  expect(footer.size.height - bottom(settings)).toBeGreaterThanOrEqual(43);
  expect(app.shows('text:NSH 0.5.0 · 独立验证')).toBe(false);
  console.log('SIDEBAR_TREE_BOUNDS ' + JSON.stringify(b));
}

test('native project tree scroll reaches sixteenth session and eighth project in narrow window', async () => {
  const app = await open('./ThemeDense.tsx', { width:680, height:720, locale:'zh-CN', reducedMotion:true });
  await app.waitFor('text:项目 主题验证 A');
  for (let i = 0; i < 12 && !app.shows('id:session-合成会话 16'); i++) await app.scroll('id:projects', 140);
  await app.waitFor('id:session-合成会话 16'); await app.press('id:session-合成会话 16');
  await app.type('id:prompt', '合成密集项目树'); await app.press('id:send');
  await app.waitFor('text:tool_end · read · 错误'); await app.press('id:stop');
  await app.waitUntil(() => app.texts().some(t => t.includes('cancelled · 已排空')));
  await app.screenshot('tree-dense-session-16.png');
  for (let i = 0; i < 8 && !app.shows('id:project-主题验证 H'); i++) await app.scroll('id:projects', 140);
  await app.waitFor('id:project-主题验证 H'); await app.press('id:project-主题验证 H');
  await app.waitFor('text:项目 主题验证 H'); expect(app.shows('text:tool_end · read · 错误')).toBe(false);
  // Variable-height group moves on project switch; explicitly scroll, never a test-only jump.
  await app.scroll('id:projects', 2000);
  await app.waitFor('id:session-合成会话 16'); await app.press('id:session-合成会话 16');
  await app.waitFor('id:session-label-h-15');
  await app.screenshot('tree-dense-project-h.png');
});
