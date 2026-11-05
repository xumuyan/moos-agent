import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

test('native passive permission probe reports status without capture or input',
  { skip: process.platform !== 'darwin', timeout: 30000 }, () => {
    mkdirSync('.generated/tests', { recursive: true });
    const binary = resolve('.generated/tests/moos-native');
    execFileSync('xcrun', ['swiftc', '-target', 'arm64-apple-macosx14.0', 'probes/m01/native.swift', '-o', binary]);
    assert.match(execFileSync('otool', ['-l', binary], { encoding: 'utf8' }), /minos 14\.0/);
    const result = JSON.parse(execFileSync(binary, ['permissions'], { encoding: 'utf8' }));
    assert.equal(typeof result.screenCaptureGranted, 'boolean');
    assert.equal(typeof result.accessibilityGranted, 'boolean');
    assert.equal(result.inputInjected, false);
    assert.equal(result.screenshotCaptured, false);
    assert.equal(result.displayQuerySucceeded, true);
    assert(result.activeDisplays > 0);
    const routes = JSON.parse(execFileSync(binary, ['permission-settings'], { encoding: 'utf8' }));
    assert.equal(routes['request-screen'], 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
    assert.equal(routes['request-accessibility'], 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
    assert.notEqual(routes['request-screen'], routes['request-accessibility']);
    const events = JSON.parse(execFileSync(binary, ['keyboard-events'], { encoding: 'utf8' }));
    assert.equal(events.shortcutDownFlags, 1 << 20, 'only shortcut key-down carries Command');
    for (const field of ['shortcutUpFlags', 'textDownFlags', 'textUpFlags', 'returnDownFlags', 'returnUpFlags']) {
      assert.equal(events[field], 0, `${field} must not inherit the previous Command modifier`);
    }
    assert.equal(events.inputInjected, false);
    const displays = JSON.parse(execFileSync(binary, ['displays'], { encoding: 'utf8' }));
    assert.equal(displays.inputInjected, false);
    assert.equal(displays.screenshotCaptured, false);
    assert(displays.displays.length > 0);
    assert.equal(displays.displays.filter(display => display.isPrimary).length, 1);
    for (const display of displays.displays) {
      assert(display.scale >= 1);
      assert(display.width > 0 && display.height > 0);
    }
    for (const [x, y, primaryHeight, scale, width, height, want] of [
      [200, 300, 1080, 1, 520, 200, { x: 200, y: 780, width: 520, height: 200 }],
      [-500, 1400, 1080, 2, 520.25, 200.25, { x: -500, y: -320, width: 1041, height: 401 }],
      [2200, -200, 1080, 2, 520, 200, { x: 2200, y: 1280, width: 1040, height: 400 }],
    ]) {
      const plan = JSON.parse(execFileSync(binary,
        ['coordinate-plan', x, y, primaryHeight, scale, width, height].map(String), { encoding: 'utf8' }));
      assert.deepEqual(plan.point, { x: want.x, y: want.y });
      assert.deepEqual(plan.pixels, { width: want.width, height: want.height });
      assert.equal(plan.inputInjected, false);
    }
    for (const flags of ['000', '011', '101', '110', '111']) {
      const focus = JSON.parse(execFileSync(binary, ['input-focus', flags], { encoding: 'utf8' }));
      assert.equal(focus.allowed, flags === '111');
      assert.equal(focus.inputInjected, false);
    }
    const missingDisplay = spawnSync(binary, ['self-test', '/tmp/unused.png', '--display', '4294967295'], { encoding: 'utf8' });
    assert.equal(missingDisplay.status, 2);
    assert.equal(JSON.parse(missingDisplay.stdout).reason, 'display-not-found');
    const invalid = spawnSync(binary, ['not-a-mode']);
    assert.equal(invalid.status, 2);
    for (const args of [
      ['browser-probe', 'https://example.com', 'MOOS_M01_BROWSER_1_1', '/tmp/unused.png'],
      ['browser-probe', 'file:///tmp/index.html', 'INVALID', '/tmp/unused.png'],
    ]) {
      const rejected = spawnSync(binary, args);
      assert.equal(rejected.status, 2, 'invalid browser requests must be rejected before input');
    }
  });
