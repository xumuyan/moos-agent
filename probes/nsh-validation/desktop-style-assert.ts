// Runs against actual NSH onLayout bounds, not just design constants.
import { expect, type App } from 'nsh/test';
import { styleLayout } from './desktop-theme';
import { artAvailable } from './desktop-theme-art';
export async function assertStyleBounds(app: App, active: boolean, height: number) {
  await app.waitUntil(() => app.texts().some(t => t.startsWith('STYLE_GEOMETRY ') && t.includes('composer-statistics') && t.includes('primary-action') && t.includes('model-picker')));
  const text = app.texts().find(t => t.startsWith('STYLE_GEOMETRY '))!;
  const b = JSON.parse(text.slice('STYLE_GEOMETRY '.length));
  const safe = styleLayout(active, artAvailable);
  const bottom = (r: any) => r.origin.y + r.size.height;
  // NSH onLayout is parent-local (verified on the real native target).
  const body = b['chat-body'], outer = b['composer-safe-area'];
  const composerTop = body.origin.y + outer.origin.y + b.composer.origin.y;
  const composerBottom = composerTop + b.composer.size.height;
  const previewTop = body.origin.y + b['composer-statistics'].origin.y;
  expect(b['chat-header'].origin.y).toBeGreaterThanOrEqual(safe.trim);
  expect(composerTop - safe.frameTop).toBeGreaterThanOrEqual(bottom(b['chat-header']));
  expect(previewTop).toBeGreaterThanOrEqual(composerBottom + safe.frameBottom);
  expect(body.origin.y + bottom(b['composer-statistics'])).toBeLessThanOrEqual(height - safe.bottom);
  // The top artwork ends 52pt into the card, and the lower slice begins
  // 34pt from its bottom. Fallback has no decorative exclusion zones.
  expect(b.prompt.origin.y).toBeGreaterThanOrEqual(artAvailable ? 52 : 12);
  expect(bottom(b['composer-actions'])).toBeLessThanOrEqual(b.composer.size.height - (artAvailable ? 34 : 12));
  expect(bottom(b['primary-action'])).toBeLessThanOrEqual(b['composer-actions'].size.height);
  expect(bottom(b['model-picker'])).toBeLessThanOrEqual(b['composer-actions'].size.height);
  expect(b['composer-actions'].origin.x + b['model-picker'].origin.x).toBeGreaterThanOrEqual(artAvailable ? 24 : 12);
  expect(b['model-picker'].origin.x + b['model-picker'].size.width).toBeLessThanOrEqual(b['primary-action'].origin.x);
  expect(b['composer-actions'].origin.x + b['primary-action'].origin.x + b['primary-action'].size.width).toBeLessThanOrEqual(b.composer.size.width - (artAvailable ? 24 : 12));
  expect(b.prompt.size.width).toBeGreaterThan(100);
  expect(b.prompt.size.height).toBeGreaterThanOrEqual(28);
  expect(b['primary-action'].size.width).toBeGreaterThan(30);
  expect(b['composer-actions'].origin.y).toBeGreaterThanOrEqual(bottom(b.prompt));
  if (active && b.message) {
    expect(b.message.size.width).toBeLessThanOrEqual(680);
    expect(b.message.size.width).toBeLessThanOrEqual(b.composer.size.width * .96 + .01);
  }
  if (active && b['message-PI 公开文本']) {
    expect(b['message-PI 公开文本'].size.width).toBeLessThan(b.composer.size.width * .96);
  }
  console.log('STYLE_BOUNDS ' + JSON.stringify({ active, height, artAvailable, bounds: b }));
  return b;
}
