import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveSidebar } from './desktop-live-sidebar.ts';
test('live sidebar transmits wallpaper only with explicitly loaded art, with readable brand plate', () => {
  for (const dark of [false, true]) {
    const style = liveSidebar(true, dark);
    const alpha = parseInt(style.backgroundColor.slice(-2), 16) / 255;
    assert.ok(alpha > .25 && alpha < .55);
    assert.equal(style.brand.height, 58);
    assert.equal(style.brand.marginTop, 44);
    assert.equal(style.brand.flexShrink, 0);
    assert.equal(style.brand.borderWidth, 1);
  }
  assert.notEqual(liveSidebar(true, false).backgroundColor, liveSidebar(true, true).backgroundColor);
});
test('no-art sidebar keeps static navy fallback instead of a false empty glass preview', () => {
  for (const dark of [false, true]) {
    const style = liveSidebar(false, dark);
    assert.equal(style.backgroundColor, '#0a173b');
    assert.match(style.backgroundImage, /#102456f7/);
  }
});
