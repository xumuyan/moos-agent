import { cleanup, colorScheme, computed, createMotion, host, Image, List, platform, setColorScheme, signal, Text, View, windowSize, type Bounds, type ScrollEvent } from 'nsh';
import { currentWindow, isAvailable as desktopAvailable } from 'nsh/desktop';
import { Button, Input, TextView, Tooltip } from 'nsh/base';
import { sessionAge, sessionPreviews, sessionPreviewStatus } from './desktop-session-preview';
import type { Calls, DesktopModelCatalog, TaskRef } from './desktop-contract';
import { defaultChoice, modelCatalog, type ModelChoice } from './desktop-model-picker';
import { DesktopModelPicker } from './DesktopModelPicker';
import { DesktopComposerStatistics } from './DesktopComposerStatistics';
import { composerStatistics } from './desktop-composer-statistics';
import { DesktopSettings, type DesktopAppearance } from './DesktopSettings';
import { DesktopTurnQueue } from './DesktopTurnQueue';
import { nextTurnReady, turnQueue, validTurnText } from './desktop-turn-queue';
import { DesktopController, isTerminal, type DesktopCall } from './desktop-ui-controller';
import { desktopCall } from './desktop-ui-transport';
import { desktopTheme as t, desktopLayout, styleLayout, clamp, createMessageRows, toolCard } from './desktop-theme';
import { Art, NineSlice, Wallpaper, TopTrim, BottomTrim, SidebarCorners, artAvailable } from './desktop-theme-layers';
import { liveSidebar } from './desktop-live-sidebar';
import { sidebarTree as tree, projectTreeHeight, sessionTreeState } from './desktop-sidebar-tree';
import { sidebarFooter } from './desktop-sidebar-footer';
import { DesktopIcon } from './DesktopIcon';
import { controlFocus, controlHover, controlPressed, controlSurface } from './desktop-control-style';
import brandIcon from './assets/desktop/sidebar-icon.png';

const navigationRows = [
  { icon: 'plugins', label: '插件' }, { icon: 'background', label: '后台任务' }, { icon: 'more', label: '更多' },
] as const;
const workspaceActions = [
  { id: 'search', icon: 'search', label: '搜索' }, { id: 'workspace-options', icon: 'workspaceOptions', label: '工作区选项' },
  { id: 'add-project', icon: 'addProject', label: '添加项目' },
] as const;
function SessionActivity(props: { id: string; onLayout?: (e: { bounds: Bounds }) => void }) {
  // Maid Atelier 0.3.2 uses a fixed sapphire center and a one-second gold chase.
  const motion = createMotion({ enter: { keyframes: { opacity: [0, 1] }, duration: 1000, easing: 'linear', iterations: 'infinite', frameRate: 24 } });
  cleanup(() => motion.stop());
  return <View testID={`session-activity-${props.id}`} onLayout={props.onLayout} style={{ position: 'absolute',
    pointerEvents: 'none', left: tree.branchX - 2, top: tree.sessionHeight / 2 - 6, width: 12, height: 12 }}>
    <View style={{ position: 'absolute', left: 3, top: 3, width: 6, height: 6, borderRadius: 3,
      backgroundColor: '#1a356f', borderWidth: 1, borderColor: '#6887c2', boxShadow: '0 0 3px #e7c7809e' }}>
      <View style={{ position: 'absolute', left: 1, top: 0, width: 2, height: 2, borderRadius: 1, backgroundColor: '#e7efff' }} />
    </View>
    {[
      { left: 5, top: 0, opacity: [1, .18, .42, .72, 1] },
      { left: 10, top: 5, opacity: [.72, 1, .18, .42, .72] },
      { left: 5, top: 10, opacity: [.42, .72, 1, .18, .42] },
      { left: 0, top: 5, opacity: [.18, .42, .72, 1, .18] },
    ].map(ray => <View style={{ position: 'absolute', left: ray.left, top: ray.top, width: 2, height: 2, borderRadius: 1,
      backgroundColor: '#e2bd6e', opacity: motion.opacity.interpolate({ inputRange: [0, .25, .5, .75, 1], outputRange: ray.opacity }) }} />)}
  </View>;
}

export type DesktopActions = { controller: DesktopController; type: (text: string) => void; send: () => void; stop: () => void; project: (id: string) => Promise<void>; session: (id: string) => void; create: () => Promise<void>; history: () => HistoryPage | null };
type HistoryPage = Calls['sessions.history']['result'];
export function DesktopView(props: { ready?: (actions: DesktopActions) => void; call?: DesktopCall; persistentHistory?: boolean; onGeometry?: (name: string, bounds: Bounds) => void; onMessageScroll?: (event: ScrollEvent) => void } = {}) {
  const macWindow = platform.os === 'macos' && desktopAvailable ? currentWindow() : null;
  // Preserve the native window frame and controls, but extend artwork under them.
  macWindow?.set({ titleBar: { style: 'hidden', height: 32 } });
  const titleBar = () => macWindow?.titleBar();
  const titleBarHeight = () => titleBar()?.height ?? 0;
  const revision = signal(0), draft = signal(''), right = signal(false), navigation = signal(true);
  const settingsOpen = signal(false), appearance = signal<DesktopAppearance>('system');
  const showCharacters = signal(true), showStatistics = signal(true);
  const changeAppearance = (next: DesktopAppearance) => {
    setColorScheme(next);
    appearance.set(next);
  };
  cleanup(() => { if (appearance() !== 'system') setColorScheme('system'); });
  const catalog = signal<DesktopModelCatalog | undefined>(undefined);
  const defaultModelLabel = () => {
    const directory = catalog();
    return directory?.options.find(model => model.id === directory.defaultId)?.label;
  };
  const choices = signal(new Map<string, ModelChoice>());
  const scopeKey = (scope: { projectId: string; sessionId: string }) => JSON.stringify([scope.projectId, scope.sessionId]);
  const modelChoice = (key: string) => {
    const directory = catalog();
    return choices().get(key) ?? (directory && defaultChoice(directory.options.find(m => m.id === directory.defaultId)!));
  };
  const submitting = new Set<string>(), cancelling = new Set<string>();
  const queue = turnQueue();
  const queueRevision = signal(0);
  const queueChanged = () => queueRevision.set(queueRevision() + 1);
  const editTurn = signal<{ id: number; text: string } | null>(null);
  const outboundChoices = new Map<string, { choice?: ModelChoice }>();
  let disposed = false, pumpScheduled = false;
  const transport = props.call ?? desktopCall;
  const previews = sessionPreviews();
  const statistics = composerStatistics();
  const call: DesktopCall = async (method, params) => {
    const key = method === 'tasks.submit' ? scopeKey(params as { projectId: string; sessionId: string }) : '';
    const outbound = outboundChoices.get(key);
    const choice = key ? (outbound ? outbound.choice : modelChoice(key)) : undefined;
    const result = await transport(method, choice ? { ...params, ...choice } : params);
    if (method === 'projects.list' && !disposed) {
      const data = result as { models?: unknown } | null;
      catalog.set(data?.models === undefined ? undefined : modelCatalog(data.models));
    }
    if (!disposed && (method === 'sessions.list' || method === 'sessions.create')) {
      const { projectId } = params as { projectId: string };
      const data = result as { sessions?: unknown; session?: unknown } | null;
      previews.remember(projectId, method === 'sessions.list' ? data?.sessions : [data?.session]);
    }
    if (method === 'tasks.events' && !disposed) statistics.stage(params as TaskRef, result);
    return result;
  };
  const refresh = () => {
    if (disposed) return;
    statistics.confirm(controller.conversations.values());
    revision.set(revision() + 1);
    syncHistory();
    if (!pumpScheduled) {
      pumpScheduled = true;
      // Run outside controller emissions, then recheck selection, errors and drain.
      void Promise.resolve().then(() => { pumpScheduled = false; pumpQueue(false); });
    }
  };
  const controller = new DesktopController(call, refresh);
  function snapshot() { revision(); return controller; }
  const sessions = computed(() => snapshot().sessions);
  // Keep the native row/tooltip anchors stable across the per-task polling ticks.
  const selectedProject = computed(() => snapshot().projectId);
  const selectedSession = computed(() => snapshot().sessionId);
  const projects = computed(() => snapshot().projects);
  const historyPage = signal<HistoryPage | null>(null);
  const historyState = signal<'loading' | 'ready' | 'error'>('loading');
  let historyScope = '', historyRequest = 0;
  const selectedHistory = () => {
    const page = historyPage();
    return page && page.projectId === selectedProject() && page.sessionId === selectedSession() ? page : null;
  };
  const historyCapped = () => (selectedHistory()?.messages.length ?? 0) >= 120;
  async function loadHistory(older = false) {
    const scope = controller.current?.scope;
    if (!props.persistentHistory || disposed || !scope) return;
    const prior = selectedHistory();
    const before = older && prior ? prior.before : null;
    if (older && (!before || historyCapped() || historyState() === 'loading')) return;
    const request = ++historyRequest;
    historyState.set('loading');
    try {
      const page = await transport('sessions.history', { ...scope, before });
      if (disposed || request !== historyRequest) return;
      const existing = older && prior ? prior.messages : [];
      const ids = new Set(existing.map(m => m.id));
      if (page.projectId !== scope.projectId || page.sessionId !== scope.sessionId ||
          !Array.isArray(page.messages) || page.messages.length > 12 || (page.before !== null &&
            (page.messages.length !== 12 || page.before !== page.messages[0]?.id)) || page.messages.some(m => {
            if (!m || typeof m.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(m.id) || ids.has(m.id) ||
                !['user', 'assistant'].includes(m.role) || typeof m.text !== 'string' || m.text.length > 8192 ||
                typeof m.truncated !== 'boolean') return true;
            ids.add(m.id); return false;
          })) throw Error('invalid history page');
      historyPage.set({ ...scope, before: page.before, messages: [...page.messages, ...existing] });
      historyState.set('ready');
      // Selection may have returned to a session whose queued turn drained while loading history.
      refresh();
    } catch { if (!disposed && request === historyRequest) historyState.set('error'); }
  }
  function syncHistory() {
    if (!props.persistentHistory) return;
    const scope = controller.current?.scope;
    const key = scope ? scopeKey(scope) : '';
    if (key === historyScope) return;
    historyScope = key;
    historyRequest++;
    historyPage.set(null);
    if (scope) void loadHistory();
  }
  const cachedRows = createMessageRows();
  const messageRows = () => {
    const c = snapshot().current;
    const key = c ? scopeKey(c.scope) : '';
    if (!props.persistentHistory) return cachedRows(key, c?.rows ?? []);
    const saved = selectedHistory()?.messages.map(m => ({ role: m.role === 'user' ? '你' : 'PI 公开文本',
      body: m.text + (m.truncated ? ' [历史预览已截断]' : '') })) ?? [];
    return cachedRows(key, [...saved, ...(c?.rows ?? [])]);
  };
  const layout = () => desktopLayout(windowSize().width, right());
  const title = () => snapshot().sessions.find(s => s.id === snapshot().sessionId)?.title ?? '新会话';
  const status = () => snapshot().current ? `${snapshot().current!.task?.status ?? (snapshot().current!.busy ? 'submitting' : 'idle')} · ${snapshot().current!.busy ? (snapshot().current!.stopping ? '停止请求中，等待收尾' : '读取事件中') : snapshot().current!.drained ? '已排空' : '未确认完成'} · ${snapshot().current!.sequence} 事件` : '加载项目/会话';
  const error = () => snapshot().error || snapshot().current?.error ? `Host/任务错误：${snapshot().error || snapshot().current?.error}；不自动重放。任务结果未确认时请勿重复提交。` : snapshot().current?.task?.errorCode ? `任务错误码：${snapshot().current!.task!.errorCode}` : '';
  const dispose = () => { disposed = true; queue.clear(); statistics.clear(); outboundChoices.clear(); controller.dispose(); };
  const detach = host.on('desktop.dispose', dispose);
  cleanup(() => { detach(); dispose(); });
  const busy = computed(() => !!snapshot().current?.busy || submitting.has(snapshot().sessionId) || cancelling.has(snapshot().sessionId));
  const blocked = computed(() => disposed || !snapshot().current || snapshot().loading || !!snapshot().current?.error || !!snapshot().error);
  const historyPending = () => !!props.persistentHistory && !selectedHistory();
  const pickerScope = () => { const c = snapshot().current; return c ? scopeKey(c.scope) : ''; };
  const queuedRows = computed(() => { queueRevision(); return queue.rows(pickerScope()); });
  const hasQueuedRows = computed(() => queuedRows().length > 0);
  const canEnqueue = () => { queueRevision(); return !blocked() && !historyPending() && busy() && !queue.full(pickerScope()) && validTurnText(draft()); };
  const disabled = () => blocked() || historyPending() || busy() || !!queuedRows().length || !validTurnText(draft());
  const canStop = () => {
    const { current, sessionId } = snapshot();
    return !blocked() && !!current?.busy && !!current.task && !isTerminal(current.task.status) &&
      !current.stopping && !submitting.has(sessionId) && !cancelling.has(sessionId);
  };
  const pickerDisabled = () => blocked() || busy() || !catalog();
  const queueHeld = () => queue.paused(pickerScope()) || !nextTurnReady(snapshot().current);
  const canResume = () => !blocked() && !historyPending() && !busy() && !editTurn() && queuedRows().length > 0 && queueHeld() && nextTurnReady(snapshot().current, true);
  const queueStatus = computed(() => {
    if (snapshot().error || snapshot().current?.error) return '发送状态未确认 · 队列暂停';
    if (canResume()) return '队列已暂停';
    if (editTurn()) return '编辑完成后继续';
    return '';
  });
  function submitTurn(text: string, choice?: ModelChoice) {
    const sessionId = controller.sessionId, key = pickerScope();
    submitting.add(sessionId);
    outboundChoices.set(key, { choice });
    void controller.submit(text).finally(() => {
      outboundChoices.delete(key);
      submitting.delete(sessionId);
      refresh();
    });
  }
  function pumpQueue(resume: boolean) {
    if (disposed || blocked() || historyPending() || busy() || editTurn() || (resume && !canResume())) return;
    const row = queue.take(pickerScope(), controller.current, resume);
    if (row) { submitTurn(row.text, row.choice); queueChanged(); }
  }
  function enqueue() {
    if (disposed || !canEnqueue()) return;
    const key = pickerScope();
    if (!queue.enqueue(key, draft(), modelChoice(key))) return;
    if (controller.current?.stopping || cancelling.has(controller.sessionId)) queue.pause(key);
    draft.set('');
    queueChanged();
    refresh();
  }
  function send() {
    if (settingsOpen() || disposed || disabled()) return;
    const text = draft();
    draft.set('');
    submitTurn(text, modelChoice(pickerScope()));
  }
  function stop() {
    if (disposed || !canStop()) return;
    const sessionId = snapshot().sessionId;
    queue.pause(pickerScope());
    cancelling.add(sessionId);
    void controller.stop().finally(() => { cancelling.delete(sessionId); refresh(); });
  }
  const setEdit = (edit: { id: number; text: string } | null) => {
    if (edit && !queue.rows(pickerScope()).some(row => row.id === edit.id)) return;
    editTurn.set(edit); if (!edit) refresh();
  };
  const resetEditor = () => { draft.set(''); editTurn.set(null); };
  const project = async (id: string) => { resetEditor(); await controller.selectProject(id); };
  const session = (id: string) => { resetEditor(); controller.selectSession(id); };
  const create = async () => { resetEditor(); await controller.createSession(); };
  props.ready?.({ controller, type: text => draft.set(text), send, stop, project, session, create, history: selectedHistory });
  void controller.start();
  const dark = () => colorScheme() === 'dark';
  const ink = () => dark() ? t.dark.ink : t.ink;
  const muted = () => dark() ? '#b7c3dd' : t.muted;
  const button = { borderRadius: 10, padding: 10, backgroundColor: 'transparent' };
  const active = () => !!snapshot().current?.rows.length || !!selectedHistory()?.messages.length;
  const safe = () => styleLayout(active(), artAvailable, titleBarHeight());
  const headingShadow = () => dark() ? '0 1px 3px #050b21e6' : '0 1px 3px #f8faffe6';
  const measured = (name: string) => (e: { bounds: Bounds }) => props.onGeometry?.(name, e.bounds);
  const sidebarStyle = () => liveSidebar(artAvailable, dark());
  const footer = () => sidebarFooter(layout().sidebar, true); // this view always renders a project tree
  const sidebarWidth = () => navigation() ? layout().sidebar : 0;
  // Keep the glyph clear of both the traffic lights and the gold corner art.
  const navigationLeft = () => Math.max((titleBar()?.left ?? 0) + 8, sidebarWidth() - 54);
  const navigationHeight = () => titleBarHeight() || 32;
  const newSessionInk = artAvailable ? '#152246' : t.goldSoft;
  return (
    <View testID="desktop-root" style={{ flex: 1, flexDirection: 'row', backgroundColor: dark() ? t.dark.canvas : t.canvas, overflow: 'hidden' }}>
      <Wallpaper sidebar={sidebarWidth()} active={active()} details={layout().right} characters={showCharacters()} />
      {navigation() && <View testID="sidebar" onLayout={measured('sidebar')} style={{ width: layout().sidebar, backgroundColor: sidebarStyle().backgroundColor, backgroundImage: sidebarStyle().backgroundImage, boxShadow: t.sidebarShadow, padding: 16, gap: 10, overflow: 'hidden' }}>
        <SidebarCorners />
        <View testID="sidebar-brand" onLayout={measured('sidebar-brand')} style={{ ...sidebarStyle().brand, flexDirection: 'row', alignItems: 'center', gap: 10 }}><Image src={brandIcon} style={{ width: 28, height: 28 }} /><Text style={{ fontSize: 20, color: t.brand, fontFamily: t.fontFamily, fontWeight: '600', textShadow: '0 1px 3px #02071980' }}>沐码</Text></View>
        <View testID="new-session-frame" onLayout={measured('new-session-frame')} style={{ height: tree.newSessionHeight, marginTop: tree.newSessionMarginTop, flexShrink: 0 }}>
          <NineSlice name="new-session" source={[1400,308]} cuts={[0,210,0,210]} edges={[0,layout().compact ? 32 : 40,0,layout().compact ? 32 : 40]} fill style={{ top: 0, left: 0, right: 0, bottom: 0 }} />
          <Button testID="create-session" style={{ height: tree.newSessionHeight, flexDirection: 'row', gap: 6, justifyContent: 'center', alignItems: 'center', backgroundColor: 'transparent' }} disabled={snapshot().loading || !snapshot().projectId} disabledStyle={{ opacity: .4 }} onPress={() => void create()}>
            <DesktopIcon name="newChat" size={14} color={newSessionInk} testID="icon-new-chat" />
            <Text style={{ fontFamily: t.fontFamily, fontSize: layout().compact ? 14 : 16, fontWeight: '600', color: newSessionInk }}>新会话</Text>
          </Button>
        </View>
        <View testID="sidebar-navigation" onLayout={measured('sidebar-navigation')} style={{ flexShrink: 0, marginTop: 4 }}>
          {navigationRows.map(({ icon, label }) => <Button testID={`nav-${icon}-unavailable`} onLayout={measured(`nav-${icon}`)} accessibilityLabel={label} disabled style={{ height: tree.navigationRowHeight, paddingLeft: 4, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'transparent' }}>
            <DesktopIcon name={icon} color={t.sidebarInk} testID={`icon-nav-${icon}`} onLayout={measured(`icon-nav-${icon}`)} />
            <Text onLayout={measured(`nav-label-${icon}`)} style={{ color: t.sidebarInk, fontFamily: t.fontFamily, fontSize: 14, lineHeight: 22 }}>{label}</Text>
          </Button>)}
        </View>
        <View testID="workspace-heading" onLayout={measured('workspace-heading')} style={{ height: tree.workspaceHeight, flexShrink: 0, flexDirection: 'row', alignItems: 'center', marginTop: -2, marginRight: -8, paddingLeft: 4 }}>
          <Text class="line-clamp-1" style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: '500', fontFamily: t.fontFamily, color: t.goldSoft }}>工作区</Text>
          {workspaceActions.map(({ id, icon, label }) => <Button testID={`${id}-unavailable`} onLayout={measured(id)} accessibilityLabel={label} disabled style={{ width: 32, height: 32, justifyContent: 'center', alignItems: 'center', flexShrink: 0 }}>
            <DesktopIcon name={icon} color={t.goldSoft} testID={`icon-${id}`} onLayout={measured(`icon-${id}`)} />
          </Button>)}
        </View>
        <List testID="projects" each={projects()} estimatedItemSize={126} style={{ flex: 1, minHeight: 0 }}>
          {p => <View testID={`project-group-${p().id}`} onLayout={measured(`project-group-${p().id}`)} style={{ height: projectTreeHeight(selectedProject() === p().id, sessions().length) }}>
            <View style={{ height: tree.projectHeight }}>
              {selectedProject() === p().id && <NineSlice name="workspace-ribbon" source={[1185,240]} cuts={[0,145,0,140]} edges={[0,36,0,35]} fill style={{ top: -3, left: -12, right: 0, bottom: -3 }} />}
              <Button testID={`project-${p().name}`} style={{ ...button, height: tree.projectHeight, paddingVertical: 7, paddingLeft: 0, paddingRight: tree.projectTextRightInset, flexDirection: 'row', gap: 4, alignItems: 'center' }} onPress={() => void project(p().id)}>
                {artAvailable ? <View style={{ width: 22, height: 34, flexShrink: 0 }}><Art name="workspace-shield" style={{ top: 0, left: 0, width: 22, height: 34, objectFit: 'contain' }} /></View> : <DesktopIcon name={selectedProject() === p().id ? 'folderOpen' : 'folder'} color={t.goldSoft} testID={`icon-project-${p().id}`} />}
                <Text testID={`project-label-${p().id}`} onLayout={measured(`project-label-${p().id}`)} class="line-clamp-1" style={{ flex: 1, minWidth: 0, fontSize: 15, lineHeight: 20, fontWeight: '500', fontFamily: t.fontFamily, color: selectedProject() === p().id ? '#fff8e8' : '#d7c8a8' }}>{p().name}</Text>
              </Button>
            </View>
            {selectedProject() === p().id && <View testID="sessions" onLayout={measured('sessions')} style={{ height: sessions().length * tree.sessionHeight }}>
              {sessions().map((item, index) => {
                const activity = () => snapshot().conversations.get(item.id);
                const row = () => sessionTreeState(item, { projectId: selectedProject(), sessionId: selectedSession() }, snapshot().conversations.get(item.id));
                const selected = computed(() => row().selected);
                const working = computed(() => row().working);
                const preview = previews.read(item.projectId, item.id);
                const shownAt = signal(Date.now());
                const taskStatus = computed(() => sessionPreviewStatus(activity(), submitting.has(item.id)));
                const previewInk = { fontFamily: t.fontFamily, color: '#d3d3d7', fontSize: 12, lineHeight: 17 };
                const last = index === sessions().length - 1;
                const mid = tree.sessionHeight / 2;
                return <View style={{ height: tree.sessionHeight }}>
                  <View testID={`branch-stem-${item.id}`} style={{ position: 'absolute', pointerEvents: 'none', left: tree.branchX, top: 0, height: last ? mid : tree.sessionHeight, borderLeftWidth: 1, borderStyle: 'dashed', borderColor: '#dfcc9a99' }} />
                  <View style={{ position: 'absolute', pointerEvents: 'none', left: tree.branchX, top: mid, width: tree.branchWidth, borderTopWidth: 1, borderStyle: 'dashed', borderColor: '#dfcc9a99' }} />
                  <Button testID={`session-${item.title}`} onLayout={measured(`session-row-${item.id}`)} selected={selected()} accessibilityLabel={`${item.title}${working() ? '，任务处理中' : ''}`} style={{ height: tree.sessionHeight - 4, marginTop: 2, marginLeft: tree.branchX + tree.branchWidth, paddingLeft: 10, paddingRight: 9, justifyContent: 'center', borderRadius: 6, borderWidth: 1, borderColor: selected() ? '#e2be70b8' : 'transparent', backgroundImage: selected() ? 'linear-gradient(90deg, #526fb879, #2b468b55 72%, #142a5e38)' : undefined, backgroundColor: 'transparent' }} hoverStyle={controlHover} onPress={() => session(item.id)}
                    tooltip={<Tooltip testID={`session-preview-${item.id}`} placement="right" align="start" offset={18} margin={8} delay={500}
                      onOpen={() => shownAt.set(Date.now())}
                      style={{ width: 244, padding: 14, gap: 6, borderRadius: 12, backgroundColor: '#29292b', boxShadow: '0 4px 14px #00000030' }}>
                      <Text style={{ ...previewInk, color: '#fff', fontSize: 14, fontWeight: '500', lineHeight: 20, numberOfLines: 3 }}>{item.title}</Text>
                      {preview && <Text style={{ ...previewInk, numberOfLines: 2, textOverflow: 'ellipsis-middle' }}>{preview.workspaceLabel}</Text>}
                      {preview && <Text style={previewInk}>{sessionAge(preview.createdAt, shownAt())}</Text>}
                      {taskStatus() && <Text style={previewInk}>{taskStatus()}</Text>}
                    </Tooltip>}>
                    <Text testID={`session-label-${item.id}`} class="line-clamp-1" style={{ fontSize: 13, fontFamily: t.fontFamily, color: selected() ? '#fff8e8' : '#d7c8a8' }}>{item.title}</Text>
                  </Button>
                  {working() && <SessionActivity id={item.id} onLayout={measured(`session-activity-${item.id}`)} />}
                </View>;
              })}
            </View>}
          </View>}
        </List>
        {showCharacters() && footer().mascotVisible && <Art testID="sidebar-mascot" name="chibi" style={{ left: layout().sidebar * .52 - footer().mascotWidth / 2, bottom: footer().mascotBottom, width: footer().mascotWidth, height: Math.min(260, windowSize().height * .38), objectFit: 'contain', objectPosition: 'center bottom', opacity: .22, filter: 'brightness(1.08) contrast(1.04)' }} />}
        <View testID="sidebar-footer" onLayout={measured('sidebar-footer')} style={{ height: footer().height, flexShrink: 0, marginHorizontal: -16, marginBottom: -16 }}>
          <Art testID="sidebar-swag" name="sidebar-swag" style={{ top: 0, left: 0, right: 0, height: footer().swagHeight, objectFit: 'fill', filter: 'brightness(1.1) saturate(1.04) contrast(1.04)' }} />
          <Button testID="settings-trigger" onLayout={measured('sidebar-settings')} accessibilityLabel="设置" onPress={() => settingsOpen.set(true)}
            hoverStyle={controlHover} activeStyle={controlPressed} focusVisibleStyle={controlFocus}
            style={{ ...controlSurface, position: 'absolute', top: footer().settingsTop, left: footer().settingsInset, right: footer().settingsInset,
              height: footer().settingsHeight, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 20 }}>
            <DesktopIcon name="settings" color={t.sidebarInk} testID="icon-settings" />
            <Text style={{ color: t.sidebarInk, fontSize: 14, fontFamily: t.fontFamily }}>设置</Text>
          </Button>
        </View>
      </View>}
      <View testID="chat-column" onLayout={measured('chat-column')} style={{ flex: 1, minWidth: 0 }}>
        <TopTrim active={active()} />
        <View testID="header-safe-area" onLayout={measured('header-safe-area')} style={{ height: safe().headerTop, flexShrink: 0 }} />
        <View testID="chat-header" onLayout={measured('chat-header')} style={{ zIndex: 2, height: safe().headerBody, flexShrink: 0, paddingHorizontal: layout().inset, paddingTop: 4, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text testID="chat-title" onLayout={measured('chat-title')} class="line-clamp-1" style={{ flex: 1, minWidth: 0, color: ink(), textShadow: headingShadow(), fontFamily: t.fontFamily, fontSize: layout().compact ? 16 : 18, lineHeight: 24, fontWeight: '600' }}>{title()}</Text>
            <Button testID="toggle-details" style={{ padding: 6, flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 4 }} disabled={windowSize().width < 1100} onPress={() => right.set(!right())}>
              <Text style={{ fontFamily: t.fontFamily, fontSize: 12, color: ink(), textShadow: headingShadow() }}>{layout().right ? '收起详情' : '任务详情'}</Text>
              <DesktopIcon name="panel" mirror color={ink()} size={14} testID="icon-details" />
            </Button>
          </View>
          <Text testID="selection" onLayout={measured('selection')} class="line-clamp-1" style={{ maxWidth: '100%', fontFamily: t.fontFamily, fontSize: 11, lineHeight: 16, color: ink(), textShadow: headingShadow(), alignSelf: 'flex-start' }}>{`项目 ${snapshot().projects.find(p => p.id === snapshot().projectId)?.name ?? '—'}`}</Text>
        </View>
        <View testID="chat-body" onLayout={measured('chat-body')} style={{ flex: 1, minHeight: 0, paddingHorizontal: layout().inset, paddingTop: 12, paddingBottom: safe().bottom, gap: 8 }}>
          <Text testID="status" style={{ fontFamily: t.fontFamily, fontSize: 12, color: muted() }}>{status()}</Text>
          {!!error() && <Text testID="error" style={{ fontFamily: t.fontFamily, color: t.danger, fontSize: 13, backgroundColor: dark() ? t.dark.assistant : t.paper, padding: 8, borderRadius: 8 }}>{error()}</Text>}
          {props.persistentHistory && !!snapshot().current && historyState() === 'loading' &&
            <Text testID="history-loading" style={{ fontFamily: t.fontFamily, color: muted(), fontSize: 12 }}>正在读取历史…</Text>}
          {props.persistentHistory && historyState() === 'error' && !!snapshot().current &&
            <Button testID="history-retry" onPress={() => void loadHistory(!!selectedHistory())} style={{ ...button, alignSelf: 'flex-start' }}>
              <Text style={{ fontFamily: t.fontFamily, color: ink(), fontSize: 12 }}>历史读取失败 · 重试</Text>
            </Button>}
          {!!selectedHistory()?.before && historyState() === 'ready' && (historyCapped() ?
            <Text style={{ fontFamily: t.fontFamily, color: muted(), fontSize: 12 }}>本次最多显示 120 条历史消息，较早记录未删除</Text> :
            <Button testID="history-older" onPress={() => void loadHistory(true)} style={{ ...button, alignSelf: 'flex-start' }}>
              <Text style={{ fontFamily: t.fontFamily, color: ink(), fontSize: 12 }}>加载更早消息</Text>
            </Button>)}
          {!active() && (!props.persistentHistory || historyState() === 'ready') && <View testID="empty-state" style={{ padding: layout().compact ? 14 : 24, gap: 10, flexShrink: 0, backgroundColor: dark() ? t.dark.glass : t.glass, backdropFilter: 'blur(8px)', borderRadius: 14 }}><Text style={{ fontFamily: t.fontFamily, fontSize: layout().compact ? 20 : 27, lineHeight: layout().compact ? 24 : 32, fontWeight: '600', color: ink() }}>从一个真实任务开始</Text><Text style={{ fontFamily: t.fontFamily, fontSize: t.font, lineHeight: t.lineHeight, color: muted() }}>选择项目与会话后发送消息。这里只展示 Host 返回的公开文本、工具动作与任务状态；没有预填任务结果。</Text></View>}
          <List testID="messages" onLayout={measured('messages')} onScroll={props.onMessageScroll} each={messageRows()} initialScrollAtEnd maintainVisibleContentPosition={{ autoscrollToBottomThreshold: 48 }} estimatedItemSize={88} contentStyle={{ paddingBottom: 12 }} style={{ flex: 1, minHeight: 0 }}>
            {r => {
              const tool = computed(() => toolCard(r().role, r().body, dark()));
              const user = () => r().role === '你';
              const messageWidth = () => Math.max(0, Math.min(680, (windowSize().width - sidebarWidth() - (layout().right ? t.rightWidth : 0) - 2 * layout().inset) * .96));
              const rowLayout = (e: { bounds: Bounds }) => {
                measured('message')(e);
                measured(`message-${r().role}`)(e);
                measured(`message-${tool() ? `tool-${tool()!.phase}` : 'row'}`)(e);
              };
              // List can reuse this view for another row; both style and subtree
              // must follow its accessor, not the role at first mount.
              return <View testID="message" onLayout={rowLayout} style={{
                width: 'fit-content', maxWidth: messageWidth(), alignSelf: user() ? 'flex-end' : 'flex-start',
                marginBottom: tool() ? 6 : 12, paddingVertical: tool() ? 5 : 14, paddingHorizontal: tool() ? 10 : 18, gap: 6,
                borderRadius: tool() ? 8 : 18, borderBottomLeftRadius: tool() ? 8 : user() ? 18 : 7, borderBottomRightRadius: tool() ? 8 : user() ? 7 : 18,
                borderWidth: 1, borderColor: tool()?.edge ?? (user() ? '#c5a4687a' : dark() ? '#d3b47766' : t.line),
                backgroundColor: tool()?.surface ?? (user() ? (dark() ? t.dark.user : '#e8edf9f2') : (dark() ? t.dark.assistant : t.paper)),
                backgroundImage: tool()?.gradient,
                boxShadow: tool() ? undefined : (user() ? t.userShadow : dark() ? '0 4px 16px #00000038' : t.assistantShadow),
              }}>
                {tool() ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <DesktopIcon name={tool()?.phase === 'error' ? 'toolError' : tool()?.phase === 'end' ? 'toolDone' : 'toolStart'} size={12} color={tool()?.color ?? muted()} testID="icon-tool" />
                  <Text style={{ flexShrink: 1, minWidth: 0, fontSize: 12, lineHeight: 18, fontFamily: t.fontFamily, color: tool()?.color }}>{tool()?.label ?? ''}</Text>
                </View> : <>
                  {r().role !== '你' && r().role !== 'PI 公开文本' && <Text style={{ fontSize: 12, fontFamily: t.fontFamily, color: muted() }}>{r().role}</Text>}
                  <TextView styles={{ root: { color: ink(), fontFamily: t.fontFamily, fontSize: t.font, lineHeight: t.lineHeight }, code: { fontFamily: t.monoFont }, codeBlockCode: { fontFamily: t.monoFont } }} markdown={r().body} selectable />
                </>}
              </View>;
            }}
          </List>
          {hasQueuedRows() && <DesktopTurnQueue scope={pickerScope()} rows={queuedRows()} edit={editTurn()} status={queueStatus()} canResume={canResume()}
            dark={dark()} ink={ink()} muted={muted()} font={t.fontFamily} onLayout={measured('turn-queue')}
            onEdit={setEdit} onSave={() => {
              const edit = editTurn(); if (edit && queue.edit(pickerScope(), edit.id, edit.text)) { queueChanged(); setEdit(null); }
            }} onRemove={id => {
              queue.remove(pickerScope(), id); queueChanged(); refresh();
            }} onResume={() => pumpQueue(true)} />}
          <View testID="composer-safe-area" onLayout={measured('composer-safe-area')} style={{ paddingTop: safe().composerTop, paddingBottom: safe().composerBottom, flexShrink: 0 }}>
            <View testID="composer" onLayout={measured('composer')} style={{ height: safe().composerHeight, flexShrink: 0, paddingHorizontal: safe().composerPaddingX, paddingBottom: safe().composerPaddingBottom, paddingTop: safe().composerPaddingTop, gap: 8, borderRadius: clamp(26, windowSize().width * .02, 34), backgroundColor: t.composerBase, backgroundImage: dark() ? t.darkComposerGradient : t.composerGradient, backdropFilter: 'blur(8px) saturate(.88)', boxShadow: t.composerShadow }}>
              {artAvailable && <NineSlice testID="composer-frame" name="composer-frame" source={[1800,588]} cuts={[170,120,115,120]} edges={[72,54,52,54]} topCenter={360} onLayout={measured('composer-frame')} onCenterLayout={measured('composer-bow')} style={{ top: -20, left: -14, right: -14, bottom: -18, zIndex: 1 }} />}
              <Input testID="prompt" onLayout={measured('prompt')} accessibilityLabel="任务输入" style={{ minHeight: 32, flex: 1, zIndex: 2, fontFamily: t.fontFamily, fontSize: t.font, backgroundColor: 'transparent', color: t.composerInk, caretColor: t.caret, placeholderColor: t.placeholder }} placeholder="发消息或创建任务" autoCapitalize="none" autoCorrect={false} maxLength={4096} value={draft()} onChange={e => draft.set(e.value)} onSubmit={send} />
              <View testID="composer-actions" onLayout={measured('composer-actions')} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, zIndex: 2, height: safe().composerActionHeight, flexShrink: 0 }}>
                <View style={{ flex: 1, minWidth: 0 }} />
                {busy() && <Button testID="queue-submit" accessibilityLabel="排队发送" onPress={enqueue} disabled={!canEnqueue()}
                  hoverStyle={controlHover} activeStyle={controlPressed} focusVisibleStyle={controlFocus} disabledStyle={{ opacity: .48 }}
                  style={{ ...controlSurface, flexShrink: 0, height: 32, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontFamily: t.fontFamily, color: t.composerInk, fontSize: 12 }}>排队发送</Text>
                </Button>}
                <DesktopModelPicker scope={pickerScope()} models={catalog()?.options ?? []} choice={modelChoice(pickerScope())}
                  disabled={pickerDisabled()} dark={dark()} art={artAvailable} onLayout={measured('model-picker')} onPopupLayout={measured('model-popup')}
                  onChange={choice => { if (!pickerDisabled()) choices.set(new Map(choices()).set(pickerScope(), choice)); }} />
                <Button testID="primary-action" onLayout={measured('primary-action')} accessibilityLabel={busy() ? '停止生成' : '发送'} style={{ width: safe().composerActionHeight, height: safe().composerActionHeight, borderRadius: safe().composerActionHeight / 2, backgroundColor: t.accent, backgroundImage: t.sendGradient, borderWidth: 1, borderColor: '#e1cfaad1', boxShadow: '0 4px 12px #1a326c47', justifyContent: 'center', alignItems: 'center', flexShrink: 0 }} disabled={busy() ? !canStop() : disabled()} disabledStyle={{ opacity: .48 }} onPress={() => busy() ? stop() : send()}><DesktopIcon name={busy() ? 'stop' : 'send'} color="#fffaf0" size={16} testID={busy() ? 'icon-stop' : 'icon-send'} /></Button>
              </View>
            </View>
          </View>
          {showStatistics() && <DesktopComposerStatistics scope={pickerScope()} data={statistics.read(snapshot().current?.scope)} dark={dark()} art={artAvailable}
            height={safe().previewHeight} onLayout={measured('composer-statistics')} onTriggerLayout={measured('round-statistics')}
            onMetricsLayout={measured('statistics-metrics')} onPopupLayout={measured('statistics-popup')} />}
        </View>
        {!active() && <BottomTrim width={windowSize().width - sidebarWidth() - (layout().right ? t.rightWidth : 0)} onLayout={measured('bottom-trim')} />}
      </View>
      {layout().right && <View testID="details-panel" style={{ width: t.rightWidth, padding: 20, paddingTop: Math.max(20, titleBarHeight() + 8), gap: 18, backgroundColor: dark() ? t.dark.details : '#f2f6fdd1', backdropFilter: 'blur(12px)', borderLeftWidth: 1, borderColor: '#c5a46885' }}>
        <Text style={{ fontFamily: t.fontFamily, fontSize: 16, color: ink(), fontWeight: '600' }}>任务详情</Text><Text style={{ fontFamily: t.fontFamily, color: muted(), fontSize: 13 }}>当前会话</Text><Text style={{ fontFamily: t.fontFamily, color: ink() }}>{title()}</Text><Text style={{ fontFamily: t.fontFamily, color: muted(), fontSize: 13 }}>{status()}</Text><Text style={{ fontFamily: t.fontFamily, color: ink(), fontSize: 13 }}>{`任务 ID：${snapshot().current?.task?.id ?? '尚未提交'}`}</Text><Text style={{ fontFamily: t.fontFamily, fontSize: 12, color: muted() }}>停止响应不等于工具已退出。只有终态且事件排空才能确认本次读取结束。工具过程在对话内按真实顺序展示，此面板不生成思考文本或虚构任务。</Text>
      </View>}
      {titleBarHeight() > 0 && <View testID="window-drag-region" onLayout={measured('window-drag-region')} desktop={{ windowDrag: true }} style={{ position: 'absolute', top: 0, left: navigationLeft() + 32, right: (titleBar()?.right ?? 0) + 8, height: titleBarHeight(), zIndex: 8 }} />}
      <Button testID="toggle-navigation" onLayout={measured('toggle-navigation')} accessibilityLabel={navigation() ? '收起侧栏' : '展开侧栏'} onPress={() => navigation.set(!navigation())}
        hoverStyle={controlHover} activeStyle={controlPressed} focusVisibleStyle={controlFocus}
        style={{ ...controlSurface, position: 'absolute', top: 0, left: navigationLeft(), width: 32, height: navigationHeight(), zIndex: 9, alignItems: 'center', justifyContent: 'center' }}>
        <DesktopIcon name="panel" color={navigation() ? t.sidebarInk : artAvailable ? t.brand : ink()} testID="icon-navigation" />
      </Button>
      {settingsOpen() && <DesktopSettings onClose={() => settingsOpen.set(false)} dark={dark()} art={artAvailable}
        appearance={appearance()} onAppearance={changeAppearance} characters={showCharacters()} onCharacters={showCharacters.set}
        statistics={showStatistics()} onStatistics={showStatistics.set} defaultModel={defaultModelLabel()} onLayout={measured('settings-content')} />}
    </View>
  );
}
