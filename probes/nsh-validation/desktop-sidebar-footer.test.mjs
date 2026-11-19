import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sidebarFooter } from './desktop-sidebar-footer.ts';
test('tree mode suppresses mascot without deleting flat-mode artwork', () => {
  assert.equal(sidebarFooter(280, true).mascotVisible, false);
  assert.equal(sidebarFooter(280, false).mascotVisible, true);
  assert.equal(sidebarFooter(280, false).mascotWidth, 229.6);
});
test('responsive swag clamps independently of tree content and settings retain bottom safe space', () => {
  for (const [width, height] of [[184,54],[280,72.1],[500,94]]) {
    const f = sidebarFooter(width, true);
    assert.ok(Math.abs(f.swagHeight - height) < 1e-9);
    assert.ok(Math.abs(f.mascotBottom - (height + 94)) < 1e-9);
    assert.ok(Math.abs(f.height - f.settingsTop - f.settingsHeight - 44) < 1e-9);
    assert.equal(f.settingsInset, 18);
  }
});
