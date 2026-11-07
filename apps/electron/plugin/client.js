window.__ModuleLoader__.load({
  id: 'moos-electron-shell',
  factory(require) {
    const { createElement, useEffect, useState } = require('react');
    const sidebarIcon = ({ size }) => createElement('img', {
      src: 'data:image/png;base64,__MOOS_SIDEBAR_ICON__',
      alt: '', width: size, height: size, draggable: false, 'data-moos-sidebar-icon': '',
    });
    const sidebarName = () => createElement('span', { 'data-moos-sidebar-name': '' }, 'Moos');
    const mark = ({ size, className }) => createElement('span', {
      className, 'aria-label': 'M', role: 'img', 'data-moos-mark': '',
      style: { fontSize: size * 0.66, fontWeight: 720, lineHeight: 1 },
    }, 'M');

    const number = new Intl.NumberFormat('zh-CN');
    const percent = new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 1 });
    const count = value => value == null ? '—' : number.format(value);

    function useUsage(sessionId, refresh = 0) {
      const [result, setResult] = useState();
      useEffect(() => {
        let closed = false;
        let timer;
        async function update() {
          try {
            const data = sessionId === null
              ? await window.moosUsage.summary() : await window.moosUsage.latest(sessionId);
            if (!closed) setResult({ sessionId, data });
          } catch {
            if (!closed) setResult({ sessionId, failed: true });
          }
          if (!closed && sessionId !== null) timer = setTimeout(update, 2000);
        }
        void update();
        return () => { closed = true; clearTimeout(timer); };
      }, [sessionId, refresh]);
      return result?.sessionId === sessionId ? result : undefined;
    }

    function UsageSettings() {
      const [refresh, setRefresh] = useState(0);
      const result = useUsage(null, refresh);
      const rows = [
        ['总 Token', 'totalTokens'], ['未缓存输入', 'inputTokens'], ['输出', 'outputTokens'],
        ['缓存读取', 'cacheReadTokens'], ['缓存写入', 'cacheWriteTokens'], ['有用量记录的请求', 'requests'],
      ];
      return createElement('section', { 'data-moos-usage-settings': '' },
        createElement('h2', null, 'Token 用量'),
        createElement('p', null, '当前设备上的 PI 用量。只统计模型服务返回的记录。'),
        result?.data?.requests ? createElement('dl', null, rows.map(([label, key]) =>
          createElement('div', { key }, createElement('dt', null, label),
            createElement('dd', null, count(result.data[key]))))) :
          createElement('p', { role: 'status' }, result?.failed ? '用量读取失败，请刷新。'
            : result ? '暂无用量记录' : '正在读取用量…'),
        createElement('button', { type: 'button', onClick: () => setRefresh(value => value + 1) }, '刷新用量'));
    }

    function ComposerUsage({ sessionId }) {
      const reading = useUsage(sessionId)?.data;
      return createElement('div', { 'data-moos-composer-usage': '', title: '最近一次有用量记录的 PI 模型请求' },
        createElement('span', null, '缓存命中 ', reading?.cacheHitRate == null ? '—' : percent.format(reading.cacheHitRate)),
        createElement('span', null, '上下文 ', count(reading?.promptTokens), ' / ', count(reading?.contextWindow)));
    }

    function usePiTurn(sessionId, startSeq) {
      const [result, setResult] = useState();
      useEffect(() => {
        if (startSeq === undefined) return;
        let closed = false;
        let timer;
        async function update() {
          try {
            const data = await window.moosTurn(sessionId, startSeq);
            if (!closed) setResult({ sessionId, startSeq, data });
          } catch {
            if (!closed) setResult(undefined);
          }
          if (!closed && startSeq === null) timer = setTimeout(update, 1000);
        }
        void update();
        return () => { closed = true; clearTimeout(timer); };
      }, [sessionId, startSeq]);
      return result?.sessionId === sessionId && result.startSeq === startSeq ? result.data : undefined;
    }

    const actionStates = { running: '进行中', done: '已完成', failed: '失败', unrecorded: '结果未记录' };
    const turnStates = { queued: '排队中', running: '正在执行', succeeded: '已完成', failed: '失败',
      cancelled: '已停止', interrupted: '已中断' };
    const routeReasons = { repair: '两轮修复后验证仍失败', rate_limit: '模型服务限流', quota: '模型服务额度不足', network: '模型服务连接失败' };

    function PiProcess({ data }) {
      if (!data || (!data.actions.length && !data.route)) return null;
      return createElement('details', { 'data-moos-pi-process': '' },
        createElement('summary', null, '执行过程 · ', data.actions.length, ' 项操作 · ', turnStates[data.status]),
        data.route ? createElement('p', { 'data-moos-model-route': '' },
          data.route.previous, ' → ', data.route.current, ' · ', routeReasons[data.route.reason]) : null,
        createElement('ul', null, data.actions.map((action, index) =>
          createElement('li', { key: index },
            createElement('span', null, action.label),
            action.path || action.command ? createElement('span', { className: 'moos-action-subject' }, action.path || action.command) : null,
            createElement('small', null, actionStates[action.state])))),
        data.limited ? createElement('p', null, '仅显示前 400 条工具事件') : null);
    }

    function LivePiProcess({ sessionId }) {
      return createElement(PiProcess, { data: usePiTurn(sessionId, null) });
    }

    function PiTurnTail({ sessionId, turn }) {
      const data = usePiTurn(sessionId, turn.start?.seq);
      if (!data || (!data.actions.length && !data.files.length && !data.route)) return null;
      return createElement('div', { 'data-moos-pi-turn': '' },
        createElement(PiProcess, { data }),
        data.files.length ? createElement('section', { 'data-moos-file-fallback': '', 'aria-label': 'PI 文件操作' },
          createElement('strong', null, data.workspaceChanges ? '工作区变化 · ' : '写入或编辑了 ', data.files.length, ' 个文件'),
          createElement('ul', null, data.files.map(file => createElement('li', { key: file.path },
            createElement('span', { className: 'moos-action-subject' }, file.path), createElement('small', null, file.summary)))),
          data.filesLimited ? createElement('p', null, '部分文件超出记录范围。') : null) : null);
    }

    function apply(ctx) {
      const root = document.documentElement;
      // Desktop chrome uses the native layout, but shortcuts still use the web transport.
      if (root.dataset.moosWindow === 'darwin') root.dataset.platform = 'darwin';
      for (const [name, component] of [
        ['sidebar.brand.mark', sidebarIcon],
        ['sidebar.brand.name', sidebarName],
        ['conversation.hero.brand.mark', mark],
      ]) {
        ctx.slots.inject(name, () => ctx.slots.register({ name }, component));
      }
      if (window.moosUsage) {
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'moos-usage', order: 20, label: () => 'Token 用量',
        }, UsageSettings));
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock', id: 'moos-usage',
          inject: sessionId => ({ sessionId }),
        }, ComposerUsage));
      }
      if (window.moosTurn) {
        const sessionProps = sessionId => ({ sessionId });
        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock', id: 'moos-pi-live', inject: sessionProps,
        }, LivePiProcess));
        ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
          name: 'conversation.chat.turnTail', id: 'moos-pi-turn', inject: sessionProps,
        }, PiTurnTail));
      }
      const styles = document.createElement('style');
      styles.textContent = `
        [data-skin-chrome="titlebar-brand"] { display: none !important; }
        html[data-platform="darwin"] [data-sidebar-toggle] [data-moos-sidebar-icon] { display: none; }
        html[data-dsh-skin="maid-atelier"] [data-moos-sidebar-name] { color: #f3e3c0; }
        [data-plugin-package="moos-electron-shell"] { display: none !important; }
        [data-moos-composer-usage] { display: flex; flex-wrap: wrap; gap: 0 12px; font-size: 12px; opacity: .75; }
        [data-moos-usage-settings] h2 { margin: 0 0 8px; }
        [data-moos-usage-settings] dl > div { display: flex; justify-content: space-between; padding: 8px 0; }
        [data-moos-usage-settings] dd { margin: 0; font-variant-numeric: tabular-nums; }
        [data-moos-pi-process], [data-moos-file-fallback] { padding: 8px 12px; border: 1px solid color-mix(in srgb, currentColor 14%, transparent); border-radius: 10px; font-size: 13px; }
        [data-moos-pi-process] summary { cursor: pointer; }
        [data-moos-pi-turn] { display: grid; gap: 8px; margin-bottom: 8px; }
        :is([data-moos-pi-process], [data-moos-file-fallback]) ul { list-style: none; padding: 0; margin: 6px 0 0; }
        :is([data-moos-pi-process], [data-moos-file-fallback]) li { display: flex; align-items: baseline; gap: 8px; padding: 3px 0; }
        :is([data-moos-pi-process], [data-moos-file-fallback]) li small { margin-inline-start: auto; white-space: nowrap; opacity: .7; }
        .moos-action-subject { min-width: 0; overflow-wrap: anywhere; }
        [data-turn-tail]:has([data-changed-files]) [data-moos-file-fallback] { display: none; }
        [data-chat-flow-kind="assistant-step"] :is(.md-code-block, pre) { display: none; }
      `;
      document.head.append(styles);
      const title = document.querySelector('title');
      const renameTitle = () => {
        if (document.title.includes('DeepSeek Harness')) {
          document.title = document.title.replaceAll('DeepSeek Harness', 'Moos');
        }
      };
      const observer = new MutationObserver(renameTitle);
      if (title) observer.observe(title, { childList: true, characterData: true, subtree: true });
      renameTitle();
      ctx.on('dispose', () => {
        observer.disconnect();
        styles.remove();
        if (root.dataset.moosWindow === 'darwin') delete root.dataset.platform;
      });
    }
    return { inject: ['slots', 'shortcuts'], apply };
  },
});
