import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Type } from 'typebox';
import { createDesktopQueue } from './desktop-queue.mjs';

/**
 * M06 桌面操作工具组（PI 自定义工具）。
 *
 * - helper 不存在时返回 []，模型看不到任何桌面工具（与 image-tool 同策略）。
 * - 所有需要权限的动作经全局桌面独占队列（desktop-queue）持锁执行：
 *   一次「观察—操作—验证」= 一次工具调用 = 一次锁，完成后释放。
 * - read-only 会话拒绝全部桌面动作（屏幕点击/输入是全局副作用，不属于只读）。
 * - 权限未授予（helper exit 3）时返回结构化中文错误与恢复指引，模型可转告用户。
 */

const HELPER_VERSION = '1';
const SHARED_QUEUE = createDesktopQueue();

const KEY_CODES = {
  return: 36, enter: 36, tab: 48, space: 49, delete: 51, backspace: 51, forwarddelete: 117,
  escape: 53, left: 123, right: 124, down: 125, up: 126, home: 115, end: 119,
  pageup: 116, pagedown: 121, capslock: 57,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111,
  a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9, b: 11, n: 45, m: 46,
  q: 12, w: 13, e: 14, r: 15, y: 16, t: 17, u: 32, i: 34, o: 31, p: 35, l: 37, j: 38, k: 40,
  0: 29, 1: 18, 2: 19, 3: 20, 4: 21, 5: 23, 6: 22, 7: 26, 8: 28, 9: 25,
};

const MODIFIER_FLAGS = {
  cmd: '--cmd', command: '--cmd', alt: '--alt', option: '--alt',
  ctrl: '--ctrl', control: '--ctrl', shift: '--shift',
};

const MAX_TYPE_LENGTH = 4000;

function permissionGuidance(permission) {
  return permission === 'screen-capture'
    ? '未获得「屏幕录制」权限，无法截屏或读取窗口标题。请在 系统设置 → 隐私与安全性 → 屏幕录制与系统录音 中允许沐码，然后重试。'
    : '未获得「辅助功能」权限，无法注入鼠标或键盘。请在 系统设置 → 隐私与安全性 → 设备控制和数据访问 中允许沐码，然后重试。';
}

function runHelper(helperPath, args, { timeoutMs = 30000, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(helperPath, args, { timeout: timeoutMs, signal, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout) => {
        let payload;
        try { payload = stdout ? JSON.parse(stdout) : null; } catch { payload = null; }
        if (payload && payload.status === 'blocked') {
          const guidance = new Error(payload.permission ? permissionGuidance(payload.permission) : '缺少系统权限');
          guidance.code = 'DESKTOP_PERMISSION_REQUIRED';
          guidance.permission = payload.permission ?? 'unknown';
          reject(guidance);
          return;
        }
        if (error) {
          if (error.killed || signal?.aborted) reject(new Error('桌面操作超时或被取消'));
          else reject(new Error(`桌面 helper 执行失败（exit ${error.code ?? '?'}）：${(payload && payload.reason) || error.message}`));
          return;
        }
        if (!payload || payload.status === 'failed') {
          reject(new Error(`桌面 helper 返回失败：${payload?.reason ?? '未知原因'}`));
          return;
        }
        resolve(payload);
      });
    signal?.addEventListener('abort', () => child.kill(), { once: true });
  });
}

function queueOptions(ownerId, label, signal) {
  return { owner: ownerId, label, signal, waitTimeoutMs: 20000, runTimeoutMs: 60000, graceMs: 3000 };
}

/** helper 版本一致性校验：version 模式输出 version，permissions 模式输出 helperVersion。 */
function assertHelperPayload(payload) {
  const version = payload.version ?? payload.helperVersion;
  if (version !== HELPER_VERSION) throw new Error(`桌面 helper 版本不匹配（${version ?? '未知'}）`);
  return payload;
}

export function createDesktopTools({ helperPath, dataDir, ownerId, getMode, emit }) {
  if (!helperPath || typeof helperPath !== 'string' || !existsSync(helperPath)) return [];
  const mode = getMode ?? (() => 'danger-full-access');
  const report = (phase, extra) => {
    try { emit?.('desktop_action', { phase, owner: ownerId, ...extra }); } catch { /* 事件失败不影响动作 */ }
  };
  const queue = SHARED_QUEUE;
  const screenshotsDir = dataDir ? join(dataDir, 'screenshots', ownerId.replace(/[^a-zA-Z0-9_-]/g, '_')) : null;

  async function capturePng(args, signal) {
    if (!screenshotsDir) throw new Error('截图保存目录不可用（数据目录缺失），无法截屏');
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const target = join(screenshotsDir, `${stamp}-${Math.random().toString(36).slice(2, 8)}.png`);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    const payload = await runHelper(helperPath, ['screenshot', '--out', target, ...args], { timeoutMs: 30000, signal });
    const bytes = await readFile(target);
    return { payload, target, bytes };
  }

  function imagePart(bytes) {
    return { type: 'image', data: bytes.toString('base64'), mimeType: 'image/png' };
  }

  async function guarded(label, signal, fn) {
    if (mode() === 'read-only') throw new Error('当前会话为只读权限，桌面操作会产生全局副作用，已拒绝执行');
    const options = queueOptions(ownerId, label, signal);
    return queue.withLock({
      ...options,
      onQueued: (info) => report('queued', { label, queueAhead: info.queueAhead }),
    }, async (lockSignal) => {
      report('running', { label });
      try {
        const result = await fn(lockSignal);
        report('done', { label });
        return result;
      } catch (error) {
        const phase = error?.name === 'QueueTimeoutError' ? 'timeout'
          : error?.name === 'QueueCancelledError' ? 'cancelled' : 'failed';
        report(phase, { label, error: error.message });
        throw error;
      }
    });
  }

  const tools = [];

  tools.push({
    name: 'desktop_permissions',
    label: '查询桌面权限',
    description: '查询沐码在 Mac 上的屏幕录制与辅助功能权限状态（只读，不申请、不修改任何设置）。桌面任务开始前建议先调用一次。',
    parameters: Type.Object({}),
    async execute(toolCallId, input, signal) {
      signal?.throwIfAborted();
      if (mode() === 'read-only') throw new Error('当前会话为只读权限，桌面操作不可用');
      const payload = await runHelper(helperPath, ['permissions'], { timeoutMs: 10000, signal });
      assertHelperPayload(payload);
      const text = [
        `屏幕录制权限：${payload.screenCaptureGranted ? '已授予' : '未授予'}`,
        `辅助功能权限：${payload.accessibilityGranted ? '已授予' : '未授予'}`,
        `显示器数量：${payload.activeDisplays}`,
      ].join('；') + '。' + (!payload.screenCaptureGranted ? permissionGuidance('screen-capture')
        : !payload.accessibilityGranted ? permissionGuidance('accessibility') : '桌面操作可用。');
      return { content: [{ type: 'text', text }], details: payload };
    },
  });

  tools.push({
    name: 'desktop_screenshot',
    label: '截取屏幕',
    description: '截取整个屏幕、指定窗口或指定区域，保存 PNG 并把图片返回给你观察。坐标为全局顶左原点逻辑点。桌面观察的第一步。',
    parameters: Type.Object({
      scope: Type.Union([Type.Literal('display'), Type.Literal('window'), Type.Literal('region')]),
      displayId: Type.Optional(Type.Number({ description: 'scope=display/region 时的显示器 id（先用 displays 查询）' })),
      windowId: Type.Optional(Type.Number({ description: 'scope=window 时的窗口 id（先用 desktop_windows 查询）' })),
      region: Type.Optional(Type.Object({
        x: Type.Number(), y: Type.Number(), width: Type.Number(), height: Type.Number(),
      }, { description: 'scope=region 时的全局顶左矩形（可先截全屏确定坐标）' })),
    }),
    async execute(toolCallId, input, signal) {
      signal?.throwIfAborted();
      return guarded('截取屏幕', signal, async (lockSignal) => {
        const args = [];
        if (input.scope === 'window') {
          if (!Number.isFinite(input.windowId)) throw new Error('scope=window 需要提供 windowId');
          args.push('--window-id', String(Math.trunc(input.windowId)));
        } else {
          if (input.scope === 'region' && input.region) {
            const { x, y, width, height } = input.region;
            if (![x, y, width, height].every(v => Number.isFinite(v) && v >= 0) || width <= 0 || height <= 0) {
              throw new Error('region 需要合法的 x,y,width,height（顶左原点，宽高为正）');
            }
            args.push('--region', `${x},${y},${width},${height}`);
          }
          if (Number.isFinite(input.displayId)) args.push('--display', String(Math.trunc(input.displayId)));
        }
        const { payload, target, bytes } = await capturePng(args, lockSignal);
        const text = `截图已保存（${payload.scope}，${payload.imageWidth}x${payload.imageHeight} 像素，显示为下方图片）。`;
        return {
          content: [{ type: 'text', text }, imagePart(bytes)],
          details: { ...payload, savedTo: target, bytes: bytes.length },
        };
      });
    },
  });

  tools.push({
    name: 'desktop_click',
    label: '点击鼠标',
    description: '在全局顶左坐标 (x,y) 处点击（可选双击/右键）。建议 verify=screenshot 让点击后自动截屏返回，一次调用完成观察—操作—验证。',
    parameters: Type.Object({
      x: Type.Number(), y: Type.Number(),
      double: Type.Optional(Type.Boolean({ description: '双击' })),
      right: Type.Optional(Type.Boolean({ description: '右键' })),
      verify: Type.Optional(Type.Union([Type.Literal('none'), Type.Literal('screenshot')])),
    }),
    async execute(toolCallId, input, signal) {
      signal?.throwIfAborted();
      if (!Number.isFinite(input.x) || !Number.isFinite(input.y) || input.x < 0 || input.y < 0) {
        throw new Error('点击坐标必须是合法的非负数（全局顶左原点）');
      }
      return guarded(`点击 (${Math.round(input.x)},${Math.round(input.y)})`, signal, async (lockSignal) => {
        const args = ['click', '--at', `${input.x},${input.y}`];
        if (input.double) args.push('--double');
        if (input.right) args.push('--right');
        const payload = await runHelper(helperPath, args, { timeoutMs: 15000, signal: lockSignal });
        let shot;
        if (input.verify === 'screenshot') {
          await new Promise(resolve => setTimeout(resolve, 600));
          shot = await capturePng([], lockSignal);
        }
        const content = [{ type: 'text', text: shot
          ? `已在 (${payload.at.x},${payload.at.y}) 完成${input.double ? '双击' : input.right ? '右键' : '单击'}，点击后截图见下。`
          : `已在 (${payload.at.x},${payload.at.y}) 完成${input.double ? '双击' : input.right ? '右键' : '单击'}。` }];
        if (shot) content.push(imagePart(shot.bytes));
        return { content, details: { click: payload, ...(shot ? { screenshot: shot.payload, savedTo: shot.target } : {}) } };
      });
    },
  });

  tools.push({
    name: 'desktop_type',
    label: '键入文本',
    description: '向前台应用键入文本。回车必须显式传 pressReturn=true 才会按下，避免意外提交表单或消息。',
    parameters: Type.Object({
      text: Type.String({ description: `要键入的文本（<=${MAX_TYPE_LENGTH} 字符）` }),
      pressReturn: Type.Optional(Type.Boolean({ description: '键入后是否按一次回车' })),
    }),
    async execute(toolCallId, input, signal) {
      signal?.throwIfAborted();
      const text = typeof input.text === 'string' ? input.text : '';
      if (!text || text.length > MAX_TYPE_LENGTH || text.includes('\0')) {
        throw new Error(`text 需要为 1..${MAX_TYPE_LENGTH} 字符的字符串`);
      }
      return guarded(`键入 ${text.length} 字符`, signal, async (lockSignal) => {
        const payload = await runHelper(helperPath, ['type', '--text', text], { timeoutMs: 15000, signal: lockSignal });
        if (input.pressReturn) await runHelper(helperPath, ['key', '--code', '36'], { timeoutMs: 10000, signal: lockSignal });
        return { content: [{ type: 'text', text: `已键入 ${payload.characters} 字符${input.pressReturn ? '并按回车' : ''}。` }],
          details: payload };
      });
    },
  });

  tools.push({
    name: 'desktop_key',
    label: '按键/快捷键',
    description: '向前台应用发送单键或修饰键组合（如 cmd+l 定位地址栏）。键名支持 return/tab/space/delete/escape/箭头/f1-f12/字母/数字。',
    parameters: Type.Object({
      key: Type.String({ description: '键名，如 return、escape、l、left' }),
      modifiers: Type.Optional(Type.Array(Type.Union([
        Type.Literal('cmd'), Type.Literal('alt'), Type.Literal('ctrl'), Type.Literal('shift'),
      ]), { description: '修饰键组合，如 ["cmd"]' })),
    }),
    async execute(toolCallId, input, signal) {
      signal?.throwIfAborted();
      const keyName = String(input.key ?? '').toLowerCase();
      const keycode = KEY_CODES[keyName];
      if (keycode === undefined) throw new Error(`不支持的键名：${keyName}（支持 return/tab/space/delete/escape/箭头/f1-f12/字母/数字）`);
      const modifiers = Array.isArray(input.modifiers) ? input.modifiers : [];
      const args = ['key', '--code', String(keycode)];
      for (const modifier of modifiers) {
        const flag = MODIFIER_FLAGS[modifier];
        if (!flag) throw new Error(`不支持的修饰键：${modifier}`);
        args.push(flag);
      }
      return guarded(`按键 ${modifiers.join('+')}${modifiers.length ? '+' : ''}${keyName}`, signal, async (lockSignal) => {
        const payload = await runHelper(helperPath, args, { timeoutMs: 10000, signal: lockSignal });
        return { content: [{ type: 'text', text: `已发送按键 ${modifiers.join('+')}${modifiers.length ? '+' : ''}${keyName}（keycode ${payload.keycode}）。` }],
          details: payload };
      });
    },
  });

  tools.push({
    name: 'desktop_scroll',
    label: '滚动',
    description: '在当前鼠标位置滚动页面。dy>0 表示内容向下滚动（查看下方），dy<0 向上。',
    parameters: Type.Object({
      dx: Type.Optional(Type.Number({ description: '水平滚动量' })),
      dy: Type.Number({ description: '垂直滚动行数，向下为正' }),
    }),
    async execute(toolCallId, input, signal) {
      signal?.throwIfAborted();
      const dy = Number.isFinite(input.dy) ? input.dy : 0;
      const dx = Number.isFinite(input.dx) ? input.dx : 0;
      if (dy === 0 && dx === 0) throw new Error('滚动量为零');
      return guarded(`滚动 dy=${dy}`, signal, async (lockSignal) => {
        const payload = await runHelper(helperPath, ['scroll', '--delta', `${dx},${dy}`], { timeoutMs: 10000, signal: lockSignal });
        return { content: [{ type: 'text', text: `已滚动 dx=${payload.delta.x} dy=${payload.delta.y}。` }], details: payload };
      });
    },
  });

  tools.push({
    name: 'desktop_windows',
    label: '列出窗口',
    description: '列出在屏窗口（windowId/所属应用/标题/顶左原点边界矩形）。用于定位目标窗口与计算点击坐标。',
    parameters: Type.Object({
      app: Type.Optional(Type.String({ description: '按应用名过滤（如 Safari浏览器）' })),
    }),
    async execute(toolCallId, input, signal) {
      signal?.throwIfAborted();
      return guarded('列出窗口', signal, async (lockSignal) => {
        const args = ['windows'];
        if (input.app) args.push('--app', String(input.app));
        const payload = await runHelper(helperPath, args, { timeoutMs: 15000, signal: lockSignal });
        const lines = payload.windows.slice(0, 40).map(w =>
          `#${w.windowId} ${w.owner}${w.title ? `「${w.title}」` : ''} (${w.x},${w.y}) ${w.width}x${w.height}`);
        const text = `共 ${payload.windows.length} 个在屏窗口${payload.screenCaptureGranted ? '' : '（无屏幕录制权限，标题不可读）'}：\n` + lines.join('\n');
        return { content: [{ type: 'text', text }], details: payload };
      });
    },
  });

  tools.push({
    name: 'desktop_app',
    label: '启动/切换应用',
    description: '启动（bundle-id）或切换到已运行的应用。启动后通常配合 desktop_windows/desktop_screenshot 定位窗口。',
    parameters: Type.Object({
      action: Type.Union([Type.Literal('launch'), Type.Literal('activate')]),
      bundleId: Type.String({ description: '应用 bundle id，如 com.apple.Safari' }),
      pid: Type.Optional(Type.Number({ description: 'action=activate 时也可直接指定进程 id' })),
    }),
    async execute(toolCallId, input, signal) {
      signal?.throwIfAborted();
      const bundleId = String(input.bundleId ?? '');
      if (!/^[A-Za-z0-9][A-Za-z0-9.-]{0,199}$/.test(bundleId)) throw new Error('bundleId 格式非法');
      return guarded(`${input.action === 'launch' ? '启动' : '切换'}应用 ${bundleId}`, signal, async (lockSignal) => {
        const args = input.action === 'launch'
          ? ['launch', '--bundle-id', bundleId]
          : Number.isFinite(input.pid)
            ? ['activate', '--pid', String(Math.trunc(input.pid))]
            : ['activate', '--bundle-id', bundleId];
        const payload = await runHelper(helperPath, args, { timeoutMs: 20000, signal: lockSignal });
        return { content: [{ type: 'text', text: `应用 ${bundleId} 已${input.action === 'launch' ? '启动' : '切换到前台'}（pid ${payload.pid}）。` }],
          details: payload };
      });
    },
  });

  return tools;
}

export { SHARED_QUEUE, HELPER_VERSION };
