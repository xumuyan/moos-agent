import { expect, open, test } from 'nsh/test';

async function openSplash(entry: string, reducedMotion = false) {
  return open(entry, { width: 768, height: 540, reducedMotion });
}

test('a click dismisses the branded splash and frees the workspace controls', async () => {
  const app = await openSplash('./App.tsx');
  await app.waitFor('id:startup-splash-skip');
  await app.press('id:startup-splash-skip');
  await app.waitUntil(() => !app.shows('id:startup-splash'));
  await app.press('id:workspace-action');
  await app.waitFor('text:Clicked');
});

test('Escape skips video and restores the workspace Escape shortcut', async () => {
  const app = await openSplash('./Video.tsx');
  await app.waitFor('id:startup-splash-skip');
  await app.keyboard.press('Escape');
  await app.waitUntil(() => !app.shows('id:startup-splash'));
  await app.keyboard.press('Escape');
  await app.waitFor('text:Escape 1');
});

test('a bundled video reaches the end and automatically reveals the workspace', async () => {
  const app = await openSplash('./Video.tsx');
  await app.waitFor('id:startup-splash-skip');
  await app.waitFor('id:startup-video-ready');
  await app.waitUntil(() => !app.shows('id:startup-splash'), { timeout: 6500 });
});

test('reduced motion opens the workspace immediately', async () => {
  const app = await openSplash('./Video.tsx', true);
  await app.waitFor('id:workspace-action');
  expect(app.shows('id:startup-splash')).toBe(false);
});
