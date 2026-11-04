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
