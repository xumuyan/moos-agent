import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import { Type } from 'typebox';
import { createDesktopQueue } from './desktop-queue.mjs';
import { createDesktopTransaction } from './desktop-transaction.mjs';
import { isDeepStrictEqual } from 'node:util';

/**
 * M06 桌面操作工具组（PI 自定义工具）。
 *
 * - helper 不存在时返回 []，模型看不到任何桌面工具（与 image-tool 同策略）。
 * - 输入必须在有界桌面事务内，观察—模型决定—操作—结果验证跨调用持锁。
 * - 无事务只读查询仍逐次持锁；事务不跨任务/重启持久化，SDK finally 释放。
 * - read-only 会话拒绝全部桌面动作（屏幕点击/输入是全局副作用，不属于只读）。
 * - 权限未授予（helper exit 3）时返回结构化中文错误与恢复指引，模型可转告用户。
 */

const HELPER_VERSION = '2';
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
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(helperPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', bytes = 0, failure, killTimer;
    const stop = error => {
      if (failure) return;
      failure = error;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 1000);
    };
    const abort = () => stop(Object.assign(new Error('桌面操作被取消'), { name: 'AbortError' }));
    const timer = setTimeout(() => stop(Object.assign(new Error('桌面 helper 执行超时'), { name: 'TimeoutError' })), timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 32 * 1024 * 1024) stop(new Error('桌面 helper 输出超限'));
      else output += chunk.toString('utf8');
    });
    child.stderr.resume(); // Never expose command arguments (which may contain typed private text).
    child.once('error', error => { failure ??= new Error(`桌面 helper 无法启动（${error.code ?? 'unknown'}）`); });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    // Wait for process exit and stdio close before handing the desktop to the next owner.
    child.once('close', code => {
      clearTimeout(timer); clearTimeout(killTimer);
      signal?.removeEventListener('abort', abort);
      if (failure) return reject(failure);
      let payload;
      try { payload = JSON.parse(output); } catch { /* handled below */ }
      if (payload?.status === 'blocked') {
        return reject(Object.assign(new Error(permissionGuidance(payload.permission)), {
          code: 'DESKTOP_PERMISSION_REQUIRED', permission: payload.permission ?? 'unknown',
        }));
      }
      if (['focus-unavailable', 'focus-required', 'focus-changed', 'focus-not-editable', 'point-outside-target', 'target-occluded'].includes(payload?.reason)) {
        const reasons = {
          'focus-unavailable': '无法读取或唯一绑定前台窗口的辅助功能焦点',
          'focus-required': '缺少有效的截图焦点绑定',
          'focus-changed': '前台应用、窗口或输入焦点与截图不一致',
          'focus-not-editable': '当前焦点不是允许键入的文本控件',
          'point-outside-target': '操作坐标超出目标窗口',
          'target-occluded': '点击位置被其他窗口遮挡，或无法确认命中目标窗口',
        };
        return reject(Object.assign(new Error(`${reasons[payload.reason]}（${payload.reason}）；已停止桌面事务。请重新观察目标，不要自动抢回焦点继续输入。`), {
          code: 'DESKTOP_FOCUS_CHANGED', reason: payload.reason,
        }));
      }
      if (code !== 0 || !payload || payload.status === 'failed') {
        return reject(new Error(`桌面 helper 执行失败（exit ${code ?? '?'}）`));
      }
      resolve(payload);
    });
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

export function createDesktopTools({ helperPath, dataDir, ownerId, getMode, emit, queue = SHARED_QUEUE, queueLimits = {}, taskSignal }) {
  if (!helperPath || typeof helperPath !== 'string' || !existsSync(helperPath)) return [];
  const mode = getMode ?? (() => 'danger-full-access');
  const report = (phase, extra) => {
    try { emit?.('desktop_action', { phase, owner: ownerId, ...extra }); } catch { /* 事件失败不影响动作 */ }
  };
  const transaction = createDesktopTransaction({ queue, owner: ownerId, signal: taskSignal, report, limits: queueLimits });
  const access = () => { if (mode() === 'read-only') throw new Error('当前会话为只读权限，桌面操作会产生全局副作用，已拒绝执行'); };
  const focusArgs = focus => ['--expect-focus', JSON.stringify(focus)];
  let lastFocus;
  const changedFocus = () => Object.assign(new Error('目标窗口或焦点已经变化，已停止桌面事务；请重新观察，不要自动抢回焦点'), { code: 'DESKTOP_FOCUS_CHANGED' });
  const readFocus = async signal => {
    const focus = (await runHelper(helperPath, ['focus'], { signal })).focus;
    if (!focus || !Number.isInteger(focus.pid) || !Number.isInteger(focus.windowId)) throw changedFocus();
    return focus;
  };
  const screenshotsDir = dataDir ? join(dataDir, 'screenshots', ownerId.replace(/[^a-zA-Z0-9_-]/g, '_')) : null;

  async function capturePng(args, signal, checkFocus = false) {
    if (!screenshotsDir) throw new Error('截图保存目录不可用（数据目录缺失），无法截屏');
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    // shotId = 文件名去掉扩展名（14 位时间戳 + 12 位十六进制随机数），聊天桥接按它受控读取。
    const shotId = `${stamp}-${randomBytes(6).toString('hex')}`;
    const target = join(screenshotsDir, `${shotId}.png`);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    const focus = checkFocus ? await readFocus(signal) : undefined;
    if (checkFocus) {
      if (lastFocus && !isDeepStrictEqual(lastFocus, focus)) throw changedFocus();
      const windowIndex = args.indexOf('--window-id');
      if (args.length && (windowIndex < 0 || Number(args[windowIndex + 1]) !== focus.windowId)) throw new Error('事务截图必须指定当前前台目标窗口');
      if (!args.length) args = ['--window-id', String(focus.windowId)];
    }
    const payload = await runHelper(helperPath, ['screenshot', '--out', target, ...args], { timeoutMs: 30000, signal });
    if (checkFocus && (!focus || !isDeepStrictEqual(focus, await readFocus(signal)))) {
      throw Object.assign(new Error('截图期间焦点发生变化，已停止事务，请重新观察'), { code: 'DESKTOP_FOCUS_CHANGED' });
    }
    if (checkFocus) lastFocus = focus;
    const bytes = await readFile(target);
    // 受限事件：只含截图 ID 与尺寸，不含路径与图像内容；聊天缩略图按 ID 经 IPC 受控读取。
    try {
      emit?.('desktop_screenshot', {
        shotId, scope: payload.scope, imageWidth: payload.imageWidth, imageHeight: payload.imageHeight,
        size: bytes.length, savedTo: target,
      });
    } catch { /* 事件失败不影响动作 */ }
    return { payload, target, bytes, focus, shotId };
  }

  function imagePart(bytes) {
    return { type: 'image', data: bytes.toString('base64'), mimeType: 'image/png' };
  }

  async function refreshAfterInput(signal, focus) {
    const after = await readFocus(signal);
    if (after.pid !== focus.pid || after.windowId !== focus.windowId || !isDeepStrictEqual(after.window, focus.window)) throw changedFocus();
    lastFocus = after; // Input may intentionally move the editable focus within this same window.
  }

  async function guarded(label, signal, fn, input = {}, requiresObservation = false) {
    access();
    if (input.transactionId) return transaction.run(input.transactionId, signal, async (lockSignal, focus) => {
      const result = await fn(lockSignal, focus);
      if (requiresObservation) {
        await refreshAfterInput(lockSignal, focus);
      }
      return result;
    }, { requiresObservation, observationId: input.observationId });
    if (requiresObservation || transaction.active()) throw new Error('桌面动作必须提供本任务 transactionId 和最新 observationId；请 desktop_begin 后截图观察');
    const options = queueOptions(ownerId, label, signal);
    try {
      const result = await queue.withLock({
        ...options, ...queueLimits,
        onQueued: (info) => report('queued', { label, queueAhead: info.queueAhead }),
      }, async (lockSignal) => {
        report('running', { label });
        return fn(lockSignal);
      });
      report('done', { label });
      return result;
    } catch (error) {
      const phase = error?.name === 'QueueTimeoutError' || error?.name === 'TimeoutError'
        || error?.detail?.reason === 'run-timeout' ? 'timeout'
        : signal?.aborted || ['QueueCancelledError', 'AbortError'].includes(error?.name) ? 'cancelled' : 'failed';
      report(phase, { label }); // No raw helper output, command, input text or error body in events.
      throw error;
    }
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
    description: '截取整个屏幕、指定窗口或指定区域，保存 PNG 并把图片返回给你观察。坐标为全局顶左原点逻辑点。事务内仅允许 scope=window 截当前前台窗口，传 transactionId 获得一次性 observationId；截图期间前台焦点必须稳定。',
    parameters: Type.Object({
      transactionId: Type.Optional(Type.String()), observationId: Type.Optional(Type.String()),
      scope: Type.Union([Type.Literal('display'), Type.Literal('window'), Type.Literal('region')]),
      displayId: Type.Optional(Type.Number({ description: 'scope=display/region 时的显示器 id（先用 desktop_displays 查询）' })),
      windowId: Type.Optional(Type.Number({ description: 'scope=window 时的窗口 id（先用 desktop_windows 查询）' })),
      region: Type.Optional(Type.Object({
        x: Type.Number(), y: Type.Number(), width: Type.Number(), height: Type.Number(),
      }, { description: 'scope=region 时的全局顶左矩形（可先截全屏确定坐标）' })),
    }),
    async execute(toolCallId, input, signal) {
      signal?.throwIfAborted();
      if (!['display', 'window', 'region'].includes(input.scope)) throw new Error('scope 非法');
      if (input.transactionId && input.scope !== 'window') throw new Error('事务内观察须用 scope=window 和当前前台 windowId');
      if (input.scope === 'region' && !input.region) throw new Error('scope=region 需要 region');
      if (input.displayId !== undefined && (!Number.isSafeInteger(input.displayId) || input.displayId <= 0)) throw new Error('displayId 非法');
      const result = await guarded('截取屏幕', signal, async (lockSignal) => {
        const args = [];
        if (input.scope === 'window') {
          if ((!Number.isSafeInteger(input.windowId) || input.windowId <= 0)) throw new Error('scope=window 需要提供 windowId');
          args.push('--window-id', String(Math.trunc(input.windowId)));
        } else {
          if (input.scope === 'region' && input.region) {
            const { x, y, width, height } = input.region;
            if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
              throw new Error('region 需要合法的 x,y,width,height（顶左原点，宽高为正）');
            }
            args.push('--region', `${x},${y},${width},${height}`);
          }
          if (Number.isFinite(input.displayId)) args.push('--display', String(Math.trunc(input.displayId)));
        }
        const { payload, target, bytes, focus, shotId } = await capturePng(args, lockSignal, Boolean(input.transactionId));
        const text = `截图已保存（${payload.scope}，${payload.imageWidth}x${payload.imageHeight} 像素）：${target}。图片已返回给模型观察，缩略图（ID ${shotId}）会在聊天中显示。`;
        return {
          content: [{ type: 'text', text }, imagePart(bytes)],
          details: { ...payload, shotId, savedTo: target, bytes: bytes.length, ...(focus ? { focus } : {}) },
        };
      }, input, false);
      if (input.transactionId) {
        result.details.observationId = transaction.recordObservation(input.transactionId, result.details.focus);
        result.content[0].text += ` 本次观察 observationId=${result.details.observationId}（输入只可使用一次；动作后必须重新观察）。`;
      }
      return result;
    },
  });

  tools.push({
    name: 'desktop_click',
    label: '点击鼠标',
    description: '在全局顶左坐标 (x,y) 处点击（可选双击/右键）。建议 verify=screenshot 让点击后自动截屏返回，必须传本事务最新截图 observationId；前台窗口/焦点不匹配会停止，不自动抢回。动作后重新截图观察。',
    parameters: Type.Object({
      transactionId: Type.String(), observationId: Type.String(),
      x: Type.Number(), y: Type.Number(),
      double: Type.Optional(Type.Boolean({ description: '双击' })),
      right: Type.Optional(Type.Boolean({ description: '右键' })),
      verify: Type.Optional(Type.Union([Type.Literal('none'), Type.Literal('screenshot')])),
    }),
    async execute(toolCallId, input, signal) {
      signal?.throwIfAborted();
      if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) {
        throw new Error('点击坐标必须是有限数字（全局顶左原点，副屏允许负坐标）');
      }
      return guarded(`点击 (${Math.round(input.x)},${Math.round(input.y)})`, signal, async (lockSignal, focus) => {
        const args = ['click', '--at', `${input.x},${input.y}`];
        if (input.double) args.push('--double');
        if (input.right) args.push('--right');
        const payload = await runHelper(helperPath, [...args, ...focusArgs(focus)], { timeoutMs: 15000, signal: lockSignal });
        let shot;
        if (input.verify === 'screenshot') {
          await new Promise(resolve => setTimeout(resolve, 600));
          await refreshAfterInput(lockSignal, focus);
          shot = await capturePng([], lockSignal, true);
        }
        const content = [{ type: 'text', text: shot
          ? `已在 (${payload.at.x},${payload.at.y}) 完成${input.double ? '双击' : input.right ? '右键' : '单击'}，点击后截图见下。`
          : `已在 (${payload.at.x},${payload.at.y}) 完成${input.double ? '双击' : input.right ? '右键' : '单击'}。` }];
        if (shot) content.push(imagePart(shot.bytes));
        return { content, details: { click: payload, ...(shot ? { screenshot: shot.payload, savedTo: shot.target } : {}) } };
      }, input, true);
    },
  });

  tools.push({
    name: 'desktop_type',
    label: '键入文本',
    description: '在桌面事务内向最新观察确认的可编辑焦点键入文本。回车必须显式传 pressReturn=true 才会按下，避免意外提交表单或消息。',
    parameters: Type.Object({
      transactionId: Type.String(), observationId: Type.String(),
      text: Type.String({ description: `要键入的文本（<=${MAX_TYPE_LENGTH} 字符）` }),
      pressReturn: Type.Optional(Type.Boolean({ description: '键入后是否按一次回车' })),
    }),
    async execute(toolCallId, input, signal) {
      signal?.throwIfAborted();
      const text = typeof input.text === 'string' ? input.text : '';
      if (!text || text.length > MAX_TYPE_LENGTH || text.includes('\0')) {
        throw new Error(`text 需要为 1..${MAX_TYPE_LENGTH} 字符的字符串`);
      }
      return guarded(`键入 ${text.length} 字符`, signal, async (lockSignal, focus) => {
        const payload = await runHelper(helperPath, ['type', '--text', text, ...focusArgs(focus)], { timeoutMs: 15000, signal: lockSignal });
        if (input.pressReturn) await runHelper(helperPath, ['key', '--code', '36', ...focusArgs(focus)], { timeoutMs: 10000, signal: lockSignal });
        return { content: [{ type: 'text', text: `已键入 ${payload.characters} 字符${input.pressReturn ? '并按回车' : ''}。` }],
          details: payload };
      }, input, true);
    },
  });

  tools.push({
    name: 'desktop_key',
    label: '按键/快捷键',
    description: '在桌面事务内向最新观察确认的焦点发送单键或修饰键组合（如 cmd+l 定位地址栏）。键名支持 return/tab/space/delete/escape/箭头/f1-f12/字母/数字。',
    parameters: Type.Object({
      transactionId: Type.String(), observationId: Type.String(),
      key: Type.String({ description: '键名，如 return、escape、l、left' }),
      modifiers: Type.Optional(Type.Array(Type.Union([
        Type.Literal('cmd'), Type.Literal('alt'), Type.Literal('ctrl'), Type.Literal('shift'),
      ]), { description: '修饰键组合，如 ["cmd"]' })),
    }),
    async execute(toolCallId, input, signal) {
      signal?.throwIfAborted();
      const keyName = String(input.key ?? '').toLowerCase();
      const keycode = Object.hasOwn(KEY_CODES, keyName) ? KEY_CODES[keyName] : undefined;
      if (keycode === undefined) throw new Error(`不支持的键名：${keyName}（支持 return/tab/space/delete/escape/箭头/f1-f12/字母/数字）`);
      const modifiers = Array.isArray(input.modifiers) ? input.modifiers : [];
      const args = ['key', '--code', String(keycode)];
      for (const modifier of modifiers) {
        const flag = MODIFIER_FLAGS[modifier];
        if (!flag) throw new Error(`不支持的修饰键：${modifier}`);
        args.push(flag);
      }
      return guarded(`按键 ${modifiers.join('+')}${modifiers.length ? '+' : ''}${keyName}`, signal, async (lockSignal, focus) => {
        const payload = await runHelper(helperPath, [...args, ...focusArgs(focus)], { timeoutMs: 10000, signal: lockSignal });
        return { content: [{ type: 'text', text: `已发送按键 ${modifiers.join('+')}${modifiers.length ? '+' : ''}${keyName}（keycode ${payload.keycode}）。` }],
          details: payload };
      }, input, true);
    },
  });

  tools.push({
    name: 'desktop_scroll',
    label: '滚动',
    description: '在桌面事务内当前鼠标位置滚动页面；鼠标必须位于最新观察的目标窗口内。dy>0 表示内容向下滚动（查看下方），dy<0 向上。',
    parameters: Type.Object({
      transactionId: Type.String(), observationId: Type.String(),
      dx: Type.Optional(Type.Number({ description: '水平滚动量' })),
      dy: Type.Number({ description: '垂直滚动行数，向下为正' }),
    }),
    async execute(toolCallId, input, signal) {
      signal?.throwIfAborted();
      if (!Number.isFinite(input.dy) || Math.abs(input.dy) > 10000
        || input.dx !== undefined && (!Number.isFinite(input.dx) || Math.abs(input.dx) > 10000)) throw new Error('滚动量须为有限数字且不超过 10000');
      const dy = input.dy;
      const dx = Number.isFinite(input.dx) ? input.dx : 0;
      if (dy === 0 && dx === 0) throw new Error('滚动量为零');
      return guarded(`滚动 dy=${dy}`, signal, async (lockSignal, focus) => {
        const payload = await runHelper(helperPath, ['scroll', '--delta', `${dx},${dy}`, ...focusArgs(focus)], { timeoutMs: 10000, signal: lockSignal });
        return { content: [{ type: 'text', text: `已滚动 dx=${payload.delta.x} dy=${payload.delta.y}。` }], details: payload };
      }, input, true);
    },
  });

  tools.push({
    name: 'desktop_windows',
    label: '列出窗口',
    description: '列出在屏窗口（windowId/所属应用/标题/顶左原点边界矩形）。用于定位目标窗口与计算点击坐标。',
    parameters: Type.Object({
      transactionId: Type.Optional(Type.String()), observationId: Type.Optional(Type.String()),
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
      }, input, false);
    },
  });

  tools.push({
    name: 'desktop_app',
    label: '启动/切换应用',
    description: '启动（bundle-id）或切换到已运行的应用。启动后通常配合 desktop_windows/desktop_screenshot 定位窗口。',
    parameters: Type.Object({
      transactionId: Type.String(), observationId: Type.Optional(Type.String()),
      action: Type.Union([Type.Literal('launch'), Type.Literal('activate')]),
      bundleId: Type.String({ description: '应用 bundle id，如 com.apple.Safari' }),
      pid: Type.Optional(Type.Number({ description: 'action=activate 时也可直接指定进程 id' })),
    }),
    async execute(toolCallId, input, signal) {
      signal?.throwIfAborted();
      if (!['launch', 'activate'].includes(input.action)) throw new Error('action 非法');
      if (input.pid !== undefined && (!Number.isSafeInteger(input.pid) || input.pid <= 0)) throw new Error('pid 非法');
      const bundleId = String(input.bundleId ?? '');
      if (!/^[A-Za-z0-9][A-Za-z0-9.-]{0,199}$/.test(bundleId)) throw new Error('bundleId 格式非法');
      if (!input.transactionId) throw new Error('切换应用需要 desktop_begin 事务');
      return guarded(`${input.action === 'launch' ? '启动' : '切换'}应用 ${bundleId}`, signal, async (lockSignal) => {
        const permissions = assertHelperPayload(await runHelper(helperPath, ['permissions'], { signal: lockSignal }));
        if (!permissions.accessibilityGranted || !permissions.screenCaptureGranted) throw new Error(permissionGuidance(!permissions.accessibilityGranted ? 'accessibility' : 'screen-capture'));
        if (lastFocus && !isDeepStrictEqual(lastFocus, await readFocus(lockSignal))) throw changedFocus();
        transaction.invalidateObservation(input.transactionId);
        const args = input.action === 'launch'
          ? ['launch', '--bundle-id', bundleId]
          : Number.isFinite(input.pid)
            ? ['activate', '--pid', String(Math.trunc(input.pid))]
            : ['activate', '--bundle-id', bundleId];
        const payload = await runHelper(helperPath, args, { timeoutMs: 20000, signal: lockSignal });
        lastFocus = await readFocus(lockSignal);
        if (lastFocus.pid !== payload.pid || lastFocus.bundleId !== bundleId) throw changedFocus();
        return { content: [{ type: 'text', text: `应用 ${bundleId} 已${input.action === 'launch' ? '启动' : '切换到前台'}（pid ${payload.pid}）。` }],
          details: payload };
      }, input, false);
    },
  });

  tools.push({
    name: 'desktop_displays', label: '列出显示器',
    description: '查询显示器 id、全局顶左逻辑坐标与缩放；左侧/上方副屏坐标可为负数。截图像素须按返回的 scale 换算到逻辑点。',
    parameters: Type.Object({ transactionId: Type.Optional(Type.String()) }),
    async execute(toolCallId, input, signal) {
      return guarded('列出显示器', signal, async lockSignal => {
        const payload = await runHelper(helperPath, ['displays'], { signal: lockSignal });
        return { content: [{ type: 'text', text: JSON.stringify(payload.displays) }], details: payload };
      }, input, false);
    },
  });
  tools.push({
    name: 'desktop_begin', label: '开始桌面事务',
    description: '取得跨项目独占桌面事务（最长120秒，含模型思考时间）。返回 transactionId；后续窗口/截图/应用/输入均传此ID。输入前须截图取得一次性 observationId；每次动作后重新截图。最后必须 desktop_end 验证并释放，失败/任务结束自动释放。不允许嵌套或并行动作。',
    parameters: Type.Object({}),
    async execute(id, input, signal) {
      access();
      const transactionId = await transaction.begin(signal);
      lastFocus = undefined;
      return { content: [{ type: 'text', text: `桌面事务已取得：${transactionId}。请在120秒内完成观察—操作—验证并 desktop_end。` }], details: { transactionId } };
    },
  }, {
    name: 'desktop_end', label: '验证并结束桌面事务',
    description: 'verify：必须先在动作后 desktop_screenshot 观察并核对结果，再传最新 observationId 确认；保持同锁再次检查焦点并截图后释放。只表示完成结果观察协议，不证明业务目标成功。cancel：释放且不声称验证。',
    parameters: Type.Object({ transactionId: Type.String(), observationId: Type.Optional(Type.String()), action: Type.Union([Type.Literal('verify'), Type.Literal('cancel')]) }),
    async execute(id, input, signal) {
      if (input.action === 'cancel') {
        await transaction.cancel(input.transactionId);
        return { content: [{ type: 'text', text: '桌面事务已取消；未执行最终验证。' }], details: { resultObservationConfirmed: false, businessGoalVerified: false } };
      }
      access();
      if (input.action !== 'verify') throw new Error('action 非法');
      return transaction.run(input.transactionId, signal, async lockSignal => {
        const shot = await capturePng([], lockSignal, true);
        return { content: [{ type: 'text', text: '已在同一桌面事务内截取最终结果，事务结束。请核对图片，不得只凭工具成功宣称业务目标完成。' }, imagePart(shot.bytes)],
          details: { ...shot.payload, savedTo: shot.target, resultObservationConfirmed: true, businessGoalVerified: false } };
      }, { finish: true, requiresObservation: true, observationId: input.observationId });
    },
  });
  // Invalid schema/value or policy changes must not strand a valid task-owned lease.
  for (const tool of tools) {
    const execute = tool.execute;
    tool.execute = async (...args) => {
      try { return await execute(...args); }
      catch (error) { if (args[1]?.transactionId) await transaction.fail(args[1].transactionId, error); throw error; }
    };
  }
  Object.defineProperty(tools, 'dispose', { value: () => transaction.dispose() });
  return tools;
}

export { SHARED_QUEUE, HELPER_VERSION };
