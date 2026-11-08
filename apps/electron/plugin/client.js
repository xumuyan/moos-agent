window.__ModuleLoader__.load({
  id: 'moos-electron-shell',
  factory(require) {
    const { createElement, useEffect, useRef, useState } = require('react');
    const { Button } = require('@deepseek-ai/dsh-client-ui-primitives');
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

    const modelEfforts = [
      ['off', '关闭'], ['minimal', 'Minimal'], ['low', 'Low'],
      ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'XHigh'],
    ];
    function providerField(styles, label, element) {
      return createElement('label', { className: styles.field },
        createElement('span', { className: styles.fieldLabel }, label), element);
    }

    function providerSelect(styles, value, onChange, options, props) {
      return createElement('select', { className: `${styles.input} ${styles.selectInput}`, value,
        onChange: event => onChange(event.target.value), ...props,
      }, options.map(([id, label]) => createElement('option', { key: id, value: id }, label)));
    }

    function ConnectionTest({ connection, disabled, styles }) {
      const [selected, setSelected] = useState(0);
      const [busy, setBusy] = useState(false);
      const [status, setStatus] = useState();
      const index = Math.min(selected, connection.models.length - 1);
      const model = connection.models[index];
      const request = { id: connection.id, baseUrl: connection.baseUrl, api: connection.api,
        service: connection.service, apiKey: connection.apiKey, model };
      const revision = JSON.stringify(request);
      async function test() {
        setBusy(true);
        setStatus(undefined);
        try {
          const result = await window.moosModelSettings.test(request);
          setStatus({ revision, message: [result.message, result.status && 'HTTP ' + result.status,
            result.elapsedMs + ' 毫秒'].filter(Boolean).join(' · ') });
        } catch { setStatus({ revision, message: '测试连接失败，请重试。' }); }
        finally { setBusy(false); }
      }
      if (!model) return null;
      return createElement('div', { className: styles.field },
        providerField(styles, '连接测试模型', providerSelect(styles, String(index), value => setSelected(Number(value)),
          connection.models.map((item, at) => [String(at), item.name || item.id || '模型 ' + (at + 1)]), { disabled: disabled || busy })),
        createElement(Button, { type: 'button', variant: 'outline', size: 'sm', onClick: test,
          disabled: disabled || busy || !model.id }, busy ? '正在测试连接…' : '测试连接'),
        status?.revision === revision ? createElement('p', { role: 'status' }, status.message) : null);
    }

    function NativeConnectionEditor({ connection, editor, ...props }) {
      const { CustomProviderCard, styles } = editor;
      const moos = {
        connection,
        async save(input) {
          try { await window.moosModelSettings.save(input); }
          catch { return '保存失败。请检查服务标识、地址、密钥、模型 ID 和容量。地址变更后需重新填写密钥。'; }
        },
        async discover(input) {
          try {
            const result = await window.moosModelSettings.discover(input);
            return result.ok ? { kind: 'found', models: result.models.map(id => ({ id })) }
              : { kind: 'refused', message: result.message };
          } catch { return { kind: 'refused', message: '读取模型列表失败，请重试。' }; }
        },
        serviceField: (service, change, disabled) => providerField(styles, '服务类型',
          providerSelect(styles, service, change,
            [['openai', 'OpenAI 兼容'], ['glm', 'GLM Coding Plan'], ['deepseek', 'DeepSeek']], { disabled })),
        modelExtra: (model, position, change, disabled) => providerField(styles, '推理强度',
          providerSelect(styles, model.thinkingLevel ?? 'off', value => change('thinkingLevel', value),
            modelEfforts, { disabled, 'aria-label': '推理强度 ' + position })),
        testField: (input, disabled) => createElement(ConnectionTest, { connection: input, disabled, styles }),
      };
      return createElement(CustomProviderCard, { ...props, moos });
    }

    function ModelSettings({ t, editor, renderSlot }) {
      const [snapshot, setSnapshot] = useState({ status: 'loading', rows: [] });
      async function load() {
        try {
          const groups = await window.moosModelSettings.list();
          setSnapshot({ status: 'ready', rows: groups.map(connection => ({
            connection,
            entry: { provider: connection.id, displayName: connection.name, settingsNs: 'llm-pi-ai',
              settingsPath: ['providers', connection.id], declared: true, active: true },
            configured: true, removable: true,
            apiKeyEnv: connection.id, credential: { configured: connection.keyConfigured, writable: false },
          })) });
        } catch { setSnapshot({ status: 'error', error: '无法读取本机模型服务。', rows: [] }); }
      }
      useEffect(() => { void load(); }, []);
      function renderEditor(connection, props) {
        return createElement(NativeConnectionEditor, { ...props, key: connection?.id ?? 'new', connection, editor, t,
          taken: snapshot.rows.map(row => row.connection.id),
          protocols: ['openai-responses', 'openai-completions'], reasoningLevels: [] });
      }
      const NewEditor = useRef();
      NewEditor.current ??= props => createElement(NativeConnectionEditor, { ...props, editor, t });
      const operations = {
        moosEditor: renderEditor,
        moosNewEditor: NewEditor.current,
        async writeSettings(_namespace, [operation]) {
          try {
            if (operation.op !== 'unset') throw new Error('Invalid operation');
            await window.moosModelSettings.remove(operation.path[1]);
            return { kind: 'written' };
          } catch { return { kind: 'refused', message: '移除模型服务失败，请重试。' }; }
        },
      };
      const state = { ...snapshot, writable: true, namespaces: new Map([['llm-pi-ai', {}]]) };
      return createElement('div', { 'data-moos-model-settings': '' },
        createElement(editor.ModelsSection, {
          controller: { load, store: { getSnapshot: () => state } },
          useSnapshot: select => select(state), operations, schema: {}, t, renderSlot,
        }));
    }

    function UsageSettings({ t, TurnUsagePanel, styles }) {
      const [refresh, setRefresh] = useState(0);
      const result = useUsage(null, refresh);
      const totals = result?.data;
      return createElement('section', { className: styles.section, 'data-moos-usage-settings': '' },
        createElement('h2', { className: styles.title }, t('stats.dialog.usageTitle')),
        totals?.requests ? createElement(TurnUsagePanel, {
          embedded: true,
          t: (key, params) => t(key === 'message.turnUsage.title' ? 'stats.dialog.usageTitle' : key, params),
          usage: { totalTokens: totals.totalTokens, uncachedInputTokens: totals.inputTokens,
            outputTokens: totals.outputTokens, cacheReadTokens: totals.cacheReadTokens ?? undefined,
            cacheWriteTokens: totals.cacheWriteTokens ?? undefined },
        }) : createElement('p', { role: 'status' }, result?.failed ? '用量读取失败，请刷新。'
          : result ? '暂无用量记录' : '正在读取用量…'),
        createElement('div', null, createElement(Button, { type: 'button', size: 'sm', variant: 'outline',
          onClick: () => setRefresh(value => value + 1) }, '刷新用量')));
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
          if (!closed && (startSeq === null || startSeq === 'retry')) timer = setTimeout(update, 1000);
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

    function PiRetry({ sessionId, submit }) {
      const target = usePiTurn(sessionId, 'retry');
      const pending = useRef(false);
      const [attempt, setAttempt] = useState();
      useEffect(() => {
        if (attempt?.state !== 'accepted') return;
        const timer = setTimeout(() => setAttempt(undefined), 3000);
        return () => clearTimeout(timer);
      }, [attempt]);
      if (!target || (attempt?.id === target.id && attempt.state === 'accepted')) return null;
      const state = attempt?.id === target.id ? attempt.state : undefined;
      async function retry() {
        if (pending.current) return;
        pending.current = true;
        setAttempt({ id: target.id, state: 'sending' });
        try {
          const result = await submit(target.id);
          if (!result?.ok) throw new Error('Retry not admitted');
          setAttempt({ id: target.id, state: 'accepted' });
        } catch {
          setAttempt({ id: target.id, state: 'error' });
        } finally { pending.current = false; }
      }
      return createElement('div', { 'data-moos-pi-retry': '' },
        createElement('span', null, '上次任务', turnStates[target.status]),
        createElement('button', { type: 'button', disabled: state === 'sending', onClick: retry },
          state === 'sending' ? '正在提交…' : '继续上次任务'),
        state === 'error' ? createElement('span', { role: 'status' }, '提交失败，请重试。') : null);
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

    const taskPanel = 'moos-pi-tasks';
    const taskIcon = ({ size }) => createElement('svg', { width: size, height: size, viewBox: '0 0 24 24',
      fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true },
    createElement('path', { d: 'M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1', strokeLinecap: 'round' }));

    function PiTasks({ openSession, getTitle }) {
      const [tasks, setTasks] = useState();
      const [error, setError] = useState(false);
      useEffect(() => {
        let disposed = false;
        let timer;
        async function refresh() {
          try {
            const rows = await window.moosActiveTasks();
            if (!disposed) { setTasks(rows); setError(false); }
          } catch {
            if (!disposed) setError(true);
          }
          if (!disposed) timer = setTimeout(refresh, 1000);
        }
        void refresh();
        return () => { disposed = true; clearTimeout(timer); };
      }, []);
      return createElement('section', { 'data-moos-pi-tasks': '', 'aria-label': '后台任务' },
        createElement('div', null,
        createElement('h1', null, '后台任务'),
        createElement('p', null, '查看各工作区正在执行或排队的 PI 任务。'),
        error || !tasks?.length ? createElement('p', { role: 'status' }, error ? '任务状态读取失败，正在重试。'
          : tasks ? '当前没有正在执行或排队的任务。' : '正在读取任务…') :
          createElement('ul', null, tasks.map(task => createElement('li', { key: task.id },
            createElement('div', null, createElement('strong', null, task.project),
              createElement('span', null, turnStates[task.status])),
            createElement('button', { type: 'button', onClick: () => openSession(task.sessionId) },
              getTitle(task.sessionId) || '打开会话'))))));
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
      const { moosEditor } = require('@deepseek-ai/dsh-client-ui-settings-models');
      if (window.moosModelSettings) {
        const t = ctx.locale.bind('settings.models');
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'models', order: 10, label: () => t('nav'),
          children: { 'settings.models.provider-card': { kind: 'keyed', scope: 'root' },
            'settings.models.footer': { kind: 'list', scope: 'root' } },
        }, ({ renderSlot }) => createElement(ModelSettings, { editor: moosEditor, t, renderSlot })));
      }
      if (window.moosUsage) {
        const { TurnUsagePanel } = require('@deepseek-ai/dsh-client-ui-chat');
        const t = ctx.locale.bind('chat');
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'moos-usage', order: 20, label: () => t('stats.dialog.usageTitle'),
        }, () => createElement(UsageSettings, { t, TurnUsagePanel, styles: moosEditor.styles })));
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
        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock', id: 'moos-pi-retry',
          inject: sessionId => ({ sessionId, submit: id => ctx.sessions.binding(sessionId)?.session.prompt(
            [{ type: 'text', text: '继续上次 PI 任务' }], 'queue', undefined, 'moos-pi-retry:' + id + ':' + crypto.randomUUID(),
          ) }),
        }, PiRetry));
        ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
          name: 'conversation.chat.turnTail', id: 'moos-pi-turn', inject: sessionProps,
        }, PiTurnTail));
      }
      if (window.moosActiveTasks) {
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: taskPanel,
          inject: () => ({ openSession: id => ctx.uiWorkspace.openSession(id),
            getTitle: id => ctx.sessions.list.getSnapshot().byId[id]?.title }),
        }, PiTasks));
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: taskPanel, order: 18, label: () => '后台任务',
        }, taskIcon));
      }
      const styles = document.createElement('style');
      styles.textContent = `
        [data-skin-chrome="titlebar-brand"] { display: none !important; }
        html[data-platform="darwin"] [data-sidebar-toggle] [data-moos-sidebar-icon] { display: none; }
        html[data-dsh-skin="maid-atelier"] [data-moos-sidebar-name] { color: #f3e3c0; }
        [data-plugin-package="moos-electron-shell"] { display: none !important; }
        [data-moos-composer-usage] { display: flex; flex-wrap: wrap; gap: 0 12px; font-size: 12px; opacity: .75; }
        [data-moos-pi-process], [data-moos-file-fallback] { padding: 8px 12px; border: 1px solid color-mix(in srgb, currentColor 14%, transparent); border-radius: 10px; font-size: 13px; }
        [data-moos-pi-process] summary { cursor: pointer; }
        [data-moos-pi-retry] { display: flex; align-items: center; gap: 8px; font-size: 13px; }
        [data-moos-pi-retry] button { cursor: pointer; padding: 4px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-module-platform); color: inherit; font: inherit; }
        [data-moos-pi-tasks] { box-sizing: border-box; height: 100%; overflow: auto; padding: 32px clamp(18px, 5vw, 56px); }
        [data-moos-pi-tasks] > div { max-width: 720px; padding: 20px; border-radius: 14px; background: var(--dsw-alias-bg-module-platform, Canvas); }
        [data-moos-pi-tasks] h1 { margin: 0; font-size: 23px; }
        [data-moos-pi-tasks] p { margin: 8px 0 20px; color: var(--dsw-alias-label-secondary); }
        [data-moos-pi-tasks] ul { max-width: 720px; display: grid; gap: 8px; list-style: none; margin: 0; padding: 0; }
        [data-moos-pi-tasks] li { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; }
        [data-moos-pi-tasks] li span { margin-inline-start: 8px; color: var(--dsw-alias-label-secondary); font-size: 13px; }
        [data-moos-pi-tasks] button { cursor: pointer; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; padding: 5px 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-module-platform); color: inherit; font: inherit; }
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
    return { inject: ['locale', 'slots', 'shortcuts', 'sessions', 'uiWorkspace'], apply };
  },
});
