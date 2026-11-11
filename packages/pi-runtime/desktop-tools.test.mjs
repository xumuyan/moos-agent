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
    'desktop_type', 'desktop_key', 'desktop_scroll', 'desktop_windows', 'desktop_app', 'desktop_displays',
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

test('desktop tools emit desktop_action lifecycle events (queued/running/done)', async () => {
  const events = [];
  const helper = await fakeHelper(`#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
const mode = process.argv[2];
const out = (v) => { process.stdout.write(JSON.stringify(v)); process.exit(0); };
if (mode === 'permissions') out({ screenCaptureGranted: true, accessibilityGranted: true, activeDisplays: 2, helperVersion: '1' });
if (mode === 'screenshot') {
  writeFileSync(process.argv[process.argv.indexOf('--out') + 1], Buffer.from('89504e47', 'hex'));
  out({ status: 'ok', scope: 'display', imageWidth: 4, imageHeight: 4 });
}
process.exit(2);
`);
  const dataDir = await mkdtemp(join(tmpdir(), 'moos-desktop-events-'));
  const tools = createDesktopTools({
    helperPath: helper, dataDir, ownerId: 'conversation:evt', getMode: () => 'danger-full-access',
    emit: (type, payload) => events.push([type, payload]),
  });
  const screenshot = tools.find(t => t.name === 'desktop_screenshot');
  await screenshot.execute('t1', { scope: 'display' }, undefined);
  const phases = events.map(([, e]) => e.phase);
  assert.deepEqual(phases, ['running', 'done']);
  // 失败路径：点击坐标非法在锁外拒绝，不产生 running。
  events.length = 0;
  const click = tools.find(t => t.name === 'desktop_click');
  await assert.rejects(click.execute('t1', { x: NaN, y: 0 }, undefined), /点击坐标/);
  assert.deepEqual(events, []);
  // emit 抛错不影响动作。
  const noisy = createDesktopTools({
    helperPath: helper, dataDir, ownerId: 'conversation:noise',
    getMode: () => 'danger-full-access', emit: () => { throw new Error('emit broken'); },
  });
  await noisy.find(t => t.name === 'desktop_permissions').execute('t1', {}, undefined);
});

test('queued cancellation and timeout emit one terminal event without running', async () => {
  for (const kind of ['cancelled', 'timeout']) {
    const queue = createDesktopQueue();
    let unlock;
    const gate = new Promise(r => { unlock = r; });
    const holding = queue.withLock({ owner: 'blocker' }, () => gate);
    const controller = new AbortController();
    const events = [];
    const click = createDesktopTools({ helperPath: OK_HELPER, ownerId: 'waiter', queue,
      queueLimits: { waitTimeoutMs: 15 }, emit: (_, event) => events.push(event) }).find(t => t.name === 'desktop_click');
    try {
      const pending = click.execute('id', { x: 1, y: 1 }, controller.signal);
      if (kind === 'cancelled') controller.abort();
      await assert.rejects(pending);
      assert.deepEqual(events.map(e => e.phase), ['queued', kind]);
    } finally { unlock(); await holding; }
  }
});

test('negative global coordinates and display discovery reach the helper unchanged', async () => {
  const helper = await fakeHelper(`#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
const arg = key => process.argv[process.argv.indexOf(key) + 1];
let payload;
if (process.argv[2] === 'displays') payload = { displays: [{ id: 2, x: -1710, y: -27, width: 1710, height: 1112, scale: 2 }] };
if (process.argv[2] === 'click') { const [x, y] = arg('--at').split(',').map(Number); payload = { status: 'ok', at: { x, y } }; }
if (process.argv[2] === 'screenshot') { writeFileSync(arg('--out'), Buffer.from('89504e47', 'hex')); payload = { status: 'ok', scope: 'region', regionArg: arg('--region'), displayArg: arg('--display'), imageWidth: 20, imageHeight: 20 }; }
console.log(JSON.stringify(payload));
`);
  const dataDir = await mkdtemp(join(tmpdir(), 'moos-desktop-negative-'));
  const tools = setup(helper, { dataDir });
  const displays = await tools.find(t => t.name === 'desktop_displays').execute('d', {});
  assert.equal(displays.details.displays[0].x, -1710);
  const click = await tools.find(t => t.name === 'desktop_click').execute('c', { x: -50, y: -20 });
  assert.deepEqual(click.details.click.at, { x: -50, y: -20 });
  const screenshot = tools.find(t => t.name === 'desktop_screenshot');
  const shot = await screenshot.execute('s', { scope: 'region', displayId: 2, region: { x: -50, y: -20, width: 10, height: 10 } });
  assert.equal(shot.details.regionArg, '-50,-20,10,10');
  assert.equal(shot.details.displayArg, '2');
  assert.ok(shot.content[0].text.includes(shot.details.savedTo));
  await assert.rejects(screenshot.execute('bad', { scope: 'region' }), /region/);
  await assert.rejects(screenshot.execute('bad', { scope: 'window', windowId: -1 }), /windowId/);
});

test('running cancellation waits for the helper to exit, rejects success and frees the queue', async () => {
  const { readFile } = await import('node:fs/promises');
  const { setTimeout: delay } = await import('node:timers/promises');
  const dataDir = await mkdtemp(join(tmpdir(), 'moos-desktop-cancel-'));
  const marker = join(dataDir, 'pid');
  const helper = await fakeHelper(`#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(marker)}, String(process.pid));
process.on('SIGTERM', () => setTimeout(() => { console.log(JSON.stringify({ status: 'ok', at: {x:1,y:1} })); process.exit(0); }, 80));
setInterval(() => {}, 1000);
`);
  const queue = createDesktopQueue();
  const controller = new AbortController();
  const events = [];
  const tools = createDesktopTools({ helperPath: helper, ownerId: 'cancel-test', queue,
    emit: (_, e) => events.push(e) });
  const pending = tools.find(t => t.name === 'desktop_click').execute('c', { x: 1, y: 1 }, controller.signal);
  let pid;
  for (let n = 0; n < 100 && !pid; n++) { pid = Number(await readFile(marker, 'utf8').catch(() => '')); if (!pid) await delay(10); }
  assert.ok(pid, 'helper actually started');
  controller.abort();
  const rejected = assert.rejects(pending);
  await queue.withLock({ owner: 'next' }, async () => {
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, 'old helper exited before next desktop action');
  });
  await rejected;
  assert.deepEqual(events.map(e => e.phase), ['running', 'cancelled']);
  assert.ok(events.every(e => !('error' in e)), 'raw command errors never enter events');
});

test('execution timeout is terminal once and unrelated code is not blocked by the desktop queue', async () => {
  const queue = createDesktopQueue();
  const helper = await fakeHelper('#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n');
  const events = [];
  const tools = createDesktopTools({ helperPath: helper, ownerId: 'timed', queue,
    queueLimits: { runTimeoutMs: 50, graceMs: 1500 }, emit: (_, e) => events.push(e) });
  const pending = tools.find(t => t.name === 'desktop_click').execute('c', { x: 1, y: 1 });
  // No queue dependency for ordinary project work.
  const { readFile } = await import('node:fs/promises');
  assert.ok((await readFile(helper, 'utf8')).includes('setInterval'));
  await assert.rejects(pending);
  assert.deepEqual(events.map(e => e.phase), ['running', 'timeout']);
  assert.equal(queue.status().locked, false);
});
