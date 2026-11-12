import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// M06 P06.2：helper 源码必须能被 swiftc 干净编译，且只读命令输出结构化 JSON。
// 这些命令不需要任何系统权限；需要权限的命令（click/type/screenshot）验证
// blocked 结构化输出路径（权限未授予时 exit 3），不产生任何输入注入。

async function compileHelper() {
  const build = await mkdtemp(join(tmpdir(), 'moos-helper-'));
  const binary = join(build, 'moos-desktop-helper');
  execFileSync('/usr/bin/swiftc', ['-O', '-target', 'arm64-apple-macos14', '-o', binary,
    join(here, 'desktop-helper.swift')], { stdio: 'pipe' });
  await chmod(binary, 0o755);
  return binary;
}

const helper = await compileHelper();
const run = (...args) => JSON.parse(execFileSync(helper, args, { encoding: 'utf8' }));

test('desktop helper compiles and reports version and permissions', () => {
  const version = run('version');
  assert.equal(version.version, '2');
  assert.equal(typeof version.screenCaptureGranted, 'boolean');
  assert.equal(typeof version.accessibilityGranted, 'boolean');
  const permissions = run('permissions');
  assert.equal(typeof permissions.activeDisplays, 'number');
  assert.ok(permissions.activeDisplays >= 1);
  assert.match(permissions.system, /Version/);
  assert.equal(permissions.helperVersion, '2');
});

test('desktop helper enumerates displays with top-left global frames', () => {
  const { displays } = run('displays');
  assert.ok(displays.length >= 1);
  const primary = displays.find((display) => display.isPrimary);
  assert.ok(primary, 'exactly one primary display expected');
  assert.equal(primary.x, 0);
  assert.equal(primary.y, 0);
  assert.ok(primary.width > 0 && primary.height > 0);
  assert.ok(primary.scale === 1 || primary.scale === 2);
  for (const display of displays) {
    assert.ok(Number.isFinite(display.x) && Number.isFinite(display.y));
    assert.ok(display.scale === 1 || display.scale === 2);
  }
});

test('desktop helper lists on-screen normal-layer windows', () => {
  const { windows, screenCaptureGranted, titleRequiresScreenCapture } = run('windows');
  assert.ok(Array.isArray(windows) && windows.length >= 1);
  for (const window of windows) {
    assert.ok(Number.isInteger(window.windowId) && window.windowId > 0);
    assert.ok(Number.isInteger(window.pid));
    assert.ok(typeof window.owner === 'string' && window.owner.length > 0);
    assert.ok(window.width > 0 && window.height > 0);
    // 无录屏权限时 title 必须为空（如实缺失，不猜测窗口名）。
    if (!screenCaptureGranted) assert.equal(window.title, '');
  }
  assert.equal(titleRequiresScreenCapture, true);
});

test('desktop helper refuses input commands with structured blocked output (exit 3)', () => {
  const probe = execFileSync(helper, ['permissions'], { encoding: 'utf8' });
  if (!JSON.parse(probe).accessibilityGranted) {
    for (const [args, permission] of [
      [['click', '--at', '100,100'], 'accessibility'],
      [['scroll', '--delta', '0,3'], 'accessibility'],
      [['key', '--code', '36'], 'accessibility'],
      [['type', '--text', 'x'], 'accessibility'],
    ]) {
      let exitCode = 0;
      let stdout = '';
      try {
        stdout = execFileSync(helper, args, { encoding: 'utf8' });
      } catch (error) {
        exitCode = error.status;
        stdout = error.stdout;
      }
      const payload = JSON.parse(stdout);
      assert.equal(payload.status, 'blocked', args.join(' '));
      assert.equal(payload.reason, 'system-permission-required');
      assert.equal(payload.permission, permission);
      assert.equal(exitCode, 3, args.join(' '));
    }
  }
});

function statusOf(args) {
  try {
    execFileSync(helper, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return 0;
  } catch (error) { return error.status; }
}

test('desktop helper rejects unknown modes and bad arguments without side effects', () => {
  assert.equal(statusOf(['bogusmode']), 2);
  assert.equal(statusOf(['click']), 2);
  assert.equal(statusOf(['scroll']), 2);
  assert.equal(statusOf(['key']), 2);
  assert.equal(statusOf(['type', '--text', '']), 2);
  assert.equal(statusOf(['type', '--text', 'a'.repeat(5000)]), 2);
});

test('desktop helper source stays free of probe-only scenario remnants', async () => {
  const source = await readFile(join(here, 'desktop-helper.swift'), 'utf8');
  for (const banned of ['browser-probe', 'MOOS_M01', 'self-test', 'targetPage', 'x-apple.systempreferences']) {
    assert.ok(!source.includes(banned), `helper must not embed probe-only scenario: ${banned}`);
  }
  // up 事件标志必须显式清空（M01/E14 结论：不继承先前 Command 状态）。
  assert.match(source, /up\.flags = \[\]/);
  assert.match(source, /down\.flags = flags/);
});

test('Quartz click plans preserve signed global coordinates and generate real double-click pairs without posting', () => {
  for (const [x, y] of [[10, 20], [-1700, -27], [0, -100]]) {
    const plan = run('plan-click', '--at', `${x},${y}`, '--double');
    assert.equal(plan.posted, false);
    assert.deepEqual(plan.cgPoint, { x, y });
    assert.deepEqual(plan.events.map(e => e.clickCount), [1, 1, 2, 2]);
    assert.deepEqual(plan.events.map(e => e.type), [1, 2, 1, 2]);
    assert.ok(plan.events.every(e => e.x === x && e.y === y && e.flags === 0));
  }
});

test('native malformed capture, key and scroll arguments fail before permissions or input', () => {
  for (const args of [
    ['key', '--code', '999999'], ['scroll', '--delta', '0,1e300'],
    ['click', '--at', '1,,2'], ['screenshot'],
    ['screenshot', '--out', '/tmp/not-created.png', '--region', '1,2,-1,4'],
    ['screenshot', '--out', '/tmp/not-created.png', '--display', '-1'],
  ]) assert.equal(statusOf(args), 2, args.join(' '));
});

test('native focus predicate rejects changed process, window, element path, bounds and non-editable fields without posting', () => {
  const focus = { pid: 42, bundleId: 'com.example.fixture', windowId: 7,
    window: { x: 0, y: 0, width: 800, height: 600 }, element: { x: 20, y: 20, width: 100, height: 30 }, role: 'AXTextField', path: [0, 2] };
  const plan = (actual, expected = focus) => run('plan-focus', '--expect-focus', JSON.stringify(expected), '--actual-focus', JSON.stringify(actual), '--typing');
  assert.deepEqual(plan(focus), { posted: false, accepted: true, reason: 'matched' });
  for (const change of [{ pid: 43 }, { windowId: 8 }, { bundleId: 'other' }, { path: [1, 2] },
    { window: { ...focus.window, x: 1 } }, { element: { ...focus.element, y: 21 } }]) {
    assert.deepEqual(plan({ ...focus, ...change }), { posted: false, accepted: false, reason: 'focus-changed' });
  }
  const button = { ...focus, role: 'AXButton' };
  assert.equal(plan(button, button).reason, 'focus-not-editable');
  assert.equal(statusOf(['plan-focus', '--expect-focus', '{}', '--actual-focus', '{}']), 2);
});

test('focus query is read-only and denied permissions do not fabricate a focus snapshot', async () => {
  if (!run('permissions').accessibilityGranted) {
    try { run('focus'); assert.fail('focus must be denied'); }
    catch (e) { assert.equal(e.status, 3); assert.equal(JSON.parse(e.stdout).permission, 'accessibility'); }
  }
  const source = await readFile(join(here, 'desktop-helper.swift'), 'utf8');
  assert.match(source, /checkFocus\(args, typing: true\)/);
  assert.match(source, /checkFocus\(args, point: position\)/);
  assert.match(source, /checkFocus\(args, point: point\)/);
  assert.match(source, /checkFocus\(args\)\s+postKey/);
  assert.match(source, /target-occluded/);
});

test('Dock full-display surface is only a live AX hit-test candidate; no blanket Dock/overlay bypass', async () => {
  const classify = (changes = {}) => {
    const input = { '--owner-bundle': 'com.apple.dock', '--owner-executable': '/System/Library/CoreServices/Dock.app/Contents/MacOS/Dock',
      '--layer': '20', '--bounds': '0,0,1920,1080', '--display-bounds': '0,0,1920,1080', ...changes };
    return run('plan-occlusion', ...Object.entries(input).flat());
  };
  assert.deepEqual(classify(), { posted: false, requiresLiveAXWindowHit: true, accepted: false });
  for (const change of [{ '--owner-bundle': 'other' }, { '--owner-executable': '/tmp/Dock' },
    { '--layer': '0' }, { '--layer': '25' }, { '--bounds': '0,1000,1920,80' }, { '--bounds': '0,0,1919,1080' }]) {
    assert.equal(classify(change).requiresLiveAXWindowHit, false);
  }
  assert.equal(classify({ '--bounds': '-1800,0,1800,1200', '--display-bounds': '-1800,0,1800,1200' }).requiresLiveAXWindowHit, true);
  const source = await readFile(join(here, 'desktop-helper.swift'), 'utf8');
  assert.match(source, /pointHitsFocusedWindow\(point, actual: actual\)/);
  assert.match(source, /AXUIElementCopyElementAtPosition/);
  assert.match(source, /CFEqual\(hitWindow, window\)/);
  assert.match(source, /Int\(pid\) == actual\["pid"\]/);
});

// Source ordering is a regression guard, not native delivery acceptance.
test('Unicode dispatch retains a bounded helper lifetime after paired posts without claiming receipt', async () => {
  const source = await readFile(join(here, 'desktop-helper.swift'), 'utf8');
  const typing = source.slice(source.indexOf('if mode == "type" {'), source.indexOf('if mode == "activate" {'));
  assert.match(typing, /checkFocus\(args, typing: true\)\s+down\.post\(tap: \.cghidEventTap\)\s+up\.post\(tap: \.cghidEventTap\)/);
  assert.match(typing, /Thread\.sleep\(forTimeInterval: 0\.25\)\s+emit/);
  assert.ok(typing.indexOf('Thread.sleep') > typing.indexOf('up.post'));
  assert.match(typing, /"posted": true/);
  assert.match(typing, /"businessGoalVerified": false/);
  assert.equal((typing.match(/down\.post/g) ?? []).length, 1);
  assert.equal((typing.match(/up\.post/g) ?? []).length, 1);
  assert.doesNotMatch(typing, /^\s*(?:while |.*activate\(|.*AXUIElementSetAttributeValue|.*NSPasteboard)/m);
});
