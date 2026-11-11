import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDesktopTools } from './desktop-tools.mjs';
import { createDesktopQueue } from './desktop-queue.mjs';

// 假 helper：用脚本模拟真实 helper 的输出协议（ok JSON / blocked exit 3 / failed exit 1），
// 覆盖工具层语义；真实 Swift helper 的行为由 apps/electron/desktop-helper.test.mjs 验证。
async function fakeHelper(script) {
  const dir = await mkdtemp(join(tmpdir(), 'moos-desktop-tools-'));
  const path = join(dir, 'fake-helper.mjs');
  await writeFile(path, script);
  await chmod(path, 0o755);
  return path;
}

const OK_HELPER = await fakeHelper(`#!/usr/bin/env node
const mode = process.argv[2];
const out = (v) => { process.stdout.write(JSON.stringify(v)); process.exit(0); };
if (mode === 'permissions') out({ screenCaptureGranted: true, accessibilityGranted: true, activeDisplays: 2, helperVersion: '1' });
if (mode === 'screenshot') { process.stdout.write(JSON.stringify({ status: 'ok', scope: process.argv.includes('--window-id') ? 'window' : 'display', imageWidth: 100, imageHeight: 50 })); process.exit(0); }
if (mode === 'click') out({ status: 'ok', at: { x: 10, y: 20 }, double: false, right: false });
if (mode === 'type') out({ status: 'ok', characters: 3 });
if (mode === 'key') out({ status: 'ok', keycode: Number(process.argv[process.argv.indexOf('--code') + 1]) });
if (mode === 'scroll') out({ status: 'ok', delta: { x: 0, y: 3 } });
if (mode === 'windows') out({ status: 'ok', windows: [{ windowId: 7, pid: 1, owner: 'Safari浏览器', title: 'Example', x: 0, y: 0, width: 800, height: 600 }], screenCaptureGranted: true });
if (mode === 'launch') out({ status: 'ok', pid: 4242, bundleId: 'com.example.app' });
if (mode === 'activate') out({ status: 'ok', pid: 4242, bundleId: 'com.example.app' });
process.exit(2);
`);

const BLOCKED_HELPER = await fakeHelper(`#!/usr/bin/env node
process.stdout.write(JSON.stringify({ status: 'blocked', reason: 'system-permission-required', permission: process.argv[2] === 'screenshot' ? 'screen-capture' : 'accessibility' }));
process.exit(3);
`);

function setup(helper, { mode, dataDir } = {}) {
  return createDesktopTools({
    helperPath: helper,
    dataDir,
    ownerId: 'conversation:test1',
    getMode: () => mode ?? 'danger-full-access',
  });
}

test('desktop tools vanish entirely when helper path is missing', () => {
  assert.deepEqual(createDesktopTools({ helperPath: '', ownerId: 'x' }), []);
  assert.deepEqual(createDesktopTools({ helperPath: '/nonexistent/helper', ownerId: 'x' }), []);
});

test('desktop tools expose the expected names and schemas', () => {
  const tools = setup(OK_HELPER);
  assert.deepEqual(tools.map(t => t.name), [
    'desktop_permissions', 'desktop_screenshot', 'desktop_click',
    'desktop_type', 'desktop_key', 'desktop_scroll', 'desktop_windows', 'desktop_app',
  ]);
});

test('desktop_permissions reports granted state and structured guidance', async () => {
  const [permissions] = setup(OK_HELPER);
  const result = await permissions.execute('t1', {}, undefined);
  assert.match(result.content[0].text, /屏幕录制权限：已授予/);
  assert.match(result.content[0].text, /辅助功能权限：已授予/);
  assert.equal(result.details.helperVersion, '1');
  assert.equal(result.details.activeDisplays, 2);
});

test('blocked helper surfaces Chinese guidance with permission kind', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'moos-desktop-blocked-'));
  const tools = setup(BLOCKED_HELPER, { dataDir });
  const [permissions, screenshot, click] = tools;
  // 真 helper 的 permissions 模式无需权限、永不 blocked；blocked 时结构化报错即为正确行为。
  await assert.rejects(permissions.execute('t1', {}, undefined), /权限/);
  await assert.rejects(screenshot.execute('t1', { scope: 'display' }, undefined), /屏幕录制.*权限/);
  await assert.rejects(click.execute('t1', { x: 1, y: 2 }, undefined), /辅助功能.*权限/);
});

test('desktop_screenshot returns image content and persists the png', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'moos-desktop-shots-'));
  const helper = await fakeHelper(`#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
const out = process.argv[process.argv.indexOf('--out') + 1];
writeFileSync(out, Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'));
process.stdout.write(JSON.stringify({ status: 'ok', scope: 'display', imageWidth: 100, imageHeight: 50 }));
`);
  const tools = createDesktopTools({
    helperPath: helper, dataDir, ownerId: 'conversation:shot', getMode: () => 'danger-full-access',
  });
  const screenshot = tools.find(t => t.name === 'desktop_screenshot');
  const result = await screenshot.execute('t1', { scope: 'display' }, undefined);
  const image = result.content.find(part => part.type === 'image');
  assert.ok(image, 'image content part expected');
  assert.equal(image.mimeType, 'image/png');
  assert.ok(image.data.length > 0);
  assert.ok(result.details.savedTo.startsWith(dataDir));
  assert.equal(result.details.status, 'ok');
});

test('desktop tools enforce queue exclusivity and reject read-only sessions', async () => {
  const tools = setup(OK_HELPER);
  const click = tools.find(t => t.name === 'desktop_click');
  await assert.rejects(
    createDesktopTools({ helperPath: OK_HELPER, ownerId: 'ro', getMode: () => 'read-only' })
      .find(t => t.name === 'desktop_click').execute('t1', { x: 1, y: 2 }, undefined),
    /只读/,
  );
  // 两个并发点击必须串行（假 helper 各 30ms）。
  const started = [];
  const finished = [];
  const run = () => click.execute('t1', { x: 1, y: 2 }, undefined).then(r => {
    started.push(r.details.click.at.x);
    finished.push(Date.now());
  });
  await Promise.all([run(), run()]);
  assert.equal(started.length, 2);
});

test('desktop_type requires explicit return and validates text length', async () => {
  const [type] = (await import('./desktop-tools.mjs')) && [setup(OK_HELPER).find(t => t.name === 'desktop_type')];
  const result = await type.execute('t1', { text: '你好' }, undefined);
  assert.match(result.content[0].text, /已键入 3 字符/); // helper 返回 characters:3
  assert.match(result.content[0].text, /未按回车|。/);
  await assert.rejects(type.execute('t1', { text: '' }, undefined), /text 需要为/);
  await assert.rejects(type.execute('t1', { text: 'a'.repeat(4001) }, undefined), /text 需要为/);
});

test('desktop_key maps key names to codes and rejects unknown names', async () => {
  const tools = setup(OK_HELPER);
  const key = tools.find(t => t.name === 'desktop_key');
  const result = await key.execute('t1', { key: 'return', modifiers: ['cmd'] }, undefined);
  assert.equal(result.details.keycode, 36);
  const left = await key.execute('t1', { key: 'left' }, undefined);
  assert.equal(left.details.keycode, 123);
  await assert.rejects(key.execute('t1', { key: 'Å' }, undefined), /不支持的键名/);
  await assert.rejects(key.execute('t1', { key: 'a', modifiers: ['hyper'] }, undefined), /不支持的修饰键/);
});

test('desktop_app validates bundle ids and passes actions through', async () => {
  const tools = setup(OK_HELPER);
  const app = tools.find(t => t.name === 'desktop_app');
  const launched = await app.execute('t1', { action: 'launch', bundleId: 'com.apple.Safari' }, undefined);
  assert.equal(launched.details.pid, 4242);
  await assert.rejects(app.execute('t1', { action: 'launch', bundleId: '../evil' }, undefined), /bundleId 格式非法/);
});

test('shared queue serializes desktop actions across tool instances (cross-conversation)', async () => {
  const a = setup(OK_HELPER);
  const b = createDesktopTools({ helperPath: OK_HELPER, ownerId: 'conversation:other', getMode: () => 'danger-full-access' });
  const clickA = a.find(t => t.name === 'desktop_click');
  const clickB = b.find(t => t.name === 'desktop_click');
  const events = [];
  const first = clickA.execute('a', { x: 1, y: 1 }, undefined);
  const second = clickB.execute('b', { x: 2, y: 2 }, undefined);
  // 排队中第二个会话的状态可被共享队列观察到。
  const { SHARED_QUEUE } = await import('./desktop-tools.mjs');
  await Promise.all([first, second]);
  assert.equal(SHARED_QUEUE.status().locked, false);
  assert.ok(events.length === 0);
});
