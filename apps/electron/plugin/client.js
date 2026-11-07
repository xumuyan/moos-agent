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
