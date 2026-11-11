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
  assert.equal(version.version, '1');
  assert.equal(typeof version.screenCaptureGranted, 'boolean');
  assert.equal(typeof version.accessibilityGranted, 'boolean');
  const permissions = run('permissions');
  assert.equal(typeof permissions.activeDisplays, 'number');
  assert.ok(permissions.activeDisplays >= 1);
  assert.match(permissions.system, /Version/);
  assert.equal(permissions.helperVersion, '1');
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
