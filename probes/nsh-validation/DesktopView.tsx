import { cleanup, Clipboard, colorScheme, computed, createMotion, host, Image, List, platform, Scroll, setColorScheme, signal, Text, View, windowSize, type Bounds, type InputRef, type ScrollEvent } from 'nsh';
import { currentWindow, isAvailable as desktopAvailable } from 'nsh/desktop';
import { Button, Dialog, Input, Menu, MenuItem, MenuSeparator, TextView, Tooltip } from 'nsh/base';
import { sessionAge, sessionPreviews, sessionPreviewStatus } from './desktop-session-preview';
import type { Calls, DesktopModelCatalog, ImportedAsset, ImportedSession, Scope, Session, SessionAction, TaskRef, TeamGoal, TeamGoalAction, WorkspaceChanges } from './desktop-contract';
import { defaultChoice, modelCatalog, type ModelChoice } from './desktop-model-picker';
import { DesktopModelPicker } from './DesktopModelPicker';
import { DesktopComposerStatistics } from './DesktopComposerStatistics';
import { composerStatistics } from './desktop-composer-statistics';
import { DesktopImportedHistory, openHistoryAsset } from './DesktopImportedHistory';
import { DesktopSettings, type DesktopAppearance } from './DesktopSettings';
import { DesktopTurnQueue } from './DesktopTurnQueue';
import { nextTurnReady, turnQueue, validTurnText } from './desktop-turn-queue';
import { DesktopController, isTerminal, type DesktopCall } from './desktop-ui-controller';
import { desktopCall } from './desktop-ui-transport';
import { desktopTheme as t, desktopLayout, styleLayout, clamp, createMessageRows, presentTurns, toolCard, type TurnActivity } from './desktop-theme';
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

export type DesktopActions = { controller: DesktopController; type: (text: string) => void; send: () => void; stop: () => void; project: (id: string) => Promise<void>; session: (id: string) => void; create: () => Promise<void>; history: () => HistoryPage | null;
  attachImages: (files: File[]) => void; chooseModel: (choice: ModelChoice) => void; toggleGoal: () => void; resumeGoal: () => void; goal: () => TeamGoal | undefined };
type Attachment = { file: File; url: string };
type HistoryPage = Calls['sessions.history']['result'];
const teamGoalStatuses = { queued: '排队中', running: '进行中', paused: '已暂停', blocked: '待处理', completed: '已完成' };
const teamGoalPhases = { planning: '队长拆分', working: '成员执行', checking: '独立验收', continuing: '补齐验收差距', verified: '验收通过' };
function goalSnapshot(value: unknown, scope: Scope, taskId?: string): TeamGoal | undefined {
  if (!value || typeof value !== 'object') return;
  const goal = value as TeamGoal;
  const id = (v: unknown) => typeof v === 'string' && /^[\w-]{1,64}$/.test(v);
  if (!id(goal.id) || !id(goal.taskId) || (taskId && goal.taskId !== taskId) ||
      goal.projectId !== scope.projectId || goal.sessionId !== scope.sessionId ||
      typeof goal.objective !== 'string' || !goal.objective.trim() || goal.objective.length > 4096 ||
      !Number.isSafeInteger(goal.round) || goal.round < 0 ||
      !Number.isSafeInteger(goal.verifiedMembers) || goal.verifiedMembers < 0 || goal.verifiedMembers > 6 ||
      typeof goal.toolPreviewLimited !== 'boolean' ||
      !Object.hasOwn(teamGoalStatuses, goal.status) || !Object.hasOwn(teamGoalPhases, goal.phase)) return;
  return goal;
}

export function DesktopView(props: { ready?: (actions: DesktopActions) => void; call?: DesktopCall; persistentHistory?: boolean; onGeometry?: (name: string, bounds: Bounds) => void; onMessageScroll?: (event: ScrollEvent) => void } = {}) {
  const macWindow = platform.os === 'macos' && desktopAvailable ? currentWindow() : null;
  // Preserve the native window frame and controls, but extend artwork under them.
  macWindow?.set({ titleBar: { style: 'hidden', height: 32 } });
  const titleBar = () => macWindow?.titleBar();
  const titleBarHeight = () => titleBar()?.height ?? 0;
  const revision = signal(0), draft = signal(''), right = signal(false), navigation = signal(true);
  const visibleImported = signal<ImportedSession[]>([]), selectedImported = signal<ImportedSession | null>(null);
  const migrated = signal(false);
  const managed = signal(false), sessionDetails = signal<Session[]>([]);
  const sessionError = signal(''), sessionPending = signal(false);
  const rename = signal<string | null>(null), renameTitle = signal('');
  const archiveProject = signal(''), archivedSessions = signal<Session[]>([]), archivedImported = signal<ImportedSession[]>([]);
  const archiveLoading = signal(false), archiveError = signal('');
  let archiveRequest = 0;
  const sessionHover = signal(''), sessionMenu = signal('');
  const files = signal<Attachment[]>([]), attachmentError = signal(''), uploading = signal(false);
  const changes = signal(new Map<string, { row: number; summary: WorkspaceChanges }>());
  const openGroups = signal(new Set<string>());
  let editorVersion = 0, nextImageBatch = 0;
  let renameInput: InputRef | undefined;
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
  const outboundChoices = new Map<string, { choice?: ModelChoice; teamGoal?: TeamGoalAction; imageBatch?: string }>();
  const goalAvailable = signal(false), goalSelected = signal(false);
  const teamGoals = signal(new Map<string, TeamGoal>());
  function rememberGoal(scope: Scope, value: unknown, taskId?: string) {
    const goal = goalSnapshot(value, scope, taskId);
    if (!goal) return;
    const key = scopeKey(scope), before = teamGoals().get(key);
    if (before?.taskId === goal.taskId && before.round === goal.round && before.phase === goal.phase &&
        before.status === goal.status && before.verifiedMembers === goal.verifiedMembers &&
        before.toolPreviewLimited === goal.toolPreviewLimited && before.errorCode === goal.errorCode) return;
    teamGoals.set(new Map(teamGoals()).set(key, goal));
  }
  let disposed = false, pumpScheduled = false;
  const transport = props.call ?? desktopCall;
  const previews = sessionPreviews();
  const statistics = composerStatistics();
  const call: DesktopCall = async (method, params) => {
    const key = method === 'tasks.submit' ? scopeKey(params as { projectId: string; sessionId: string }) : '';
    const outbound = outboundChoices.get(key);
    const choice = key ? (outbound ? outbound.choice : modelChoice(key)) : undefined;
    const result = await transport(method, key && (choice || outbound)
      ? { ...params, ...choice, ...(outbound?.teamGoal && { teamGoal: outbound.teamGoal }),
        ...(outbound?.imageBatch && { imageBatch: outbound.imageBatch }) } : params);
    if (method === 'projects.list' && !disposed) {
      const data = result as { models?: unknown; teamGoals?: unknown; desktopManagement?: unknown; workspaceMigration?: unknown } | null;
      catalog.set(data?.models === undefined ? undefined : modelCatalog(data.models));
      migrated.set(data?.workspaceMigration === true);
      managed.set(props.persistentHistory === true && data?.desktopManagement === true);
      goalAvailable.set(props.persistentHistory === true && data?.teamGoals === true);
    }
    if (!disposed && (method === 'sessions.list' || method === 'sessions.create')) {
      const { projectId } = params as { projectId: string };
      const data = result as { sessions?: unknown; session?: unknown; imported?: ImportedSession[] } | null;
      previews.remember(projectId, method === 'sessions.list' ? data?.sessions : [data?.session]);
      if (managed() && projectId === controller.projectId) {
        if (Array.isArray(data?.sessions)) {
          visibleImported.set(data.imported ?? []);
          sessionDetails.set(data.sessions);
        }
        else if (data?.session) sessionDetails.set([...sessionDetails(), data.session as Session]);
      }
    }
    if (method === 'tasks.events' && !disposed) {
      statistics.stage(params as TaskRef, result);
      const page = result as Calls['tasks.events']['result'];
      const id = scopeKey(params as Scope) + ':' + page.task?.id;
      if (page.terminal && !page.hasMore && page.workspaceChanges && !changes().has(id)) {
        const row = controller.conversations.get((params as Scope).sessionId)?.rows.findLastIndex(r => r.role === '你');
        if (row !== undefined && row >= 0) changes.set(new Map(changes()).set(id, { row, summary: page.workspaceChanges }));
      }
    }
    if (goalAvailable() && !disposed && (method === 'tasks.submit' || method === 'tasks.events')) {
      const taskId = method === 'tasks.events' ? (params as TaskRef).taskId : (result as Calls['tasks.submit']['result']).task?.id;
      rememberGoal(params as Scope, (result as { teamGoal?: unknown }).teamGoal, taskId);
    }
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
  // Persistent team attempts can run for two hours; the UI stays attached through terminal drain.
  const controller = new DesktopController(call, refresh, 250, props.persistentHistory ? 36000 : undefined);
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
  const historyCapped = () => !migrated() && (selectedHistory()?.messages.length ?? 0) >= 120;
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
      if (goalAvailable()) rememberGoal(scope, page.teamGoal);
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
    const saved = selectedHistory()?.messages.flatMap(m => [
      ...((m.text || !m.assets?.length) ? [{ role: m.role === 'user' ? '你' : 'PI 公开文本',
        body: m.text + (m.truncated ? ' [历史预览已截断]' : ''), key: `saved-${m.id}` }] : []),
      ...(m.assets?.length ? [{ role: '会话附件', body: JSON.stringify(m.assets), key: `asset-${m.id}` }] : []),
    ]) ?? [];
    const live = c?.rows ?? [];
    if (!managed()) return cachedRows(key, [...saved, ...live]);
    const byTurn = new Map([...changes()].filter(([id]) => id.startsWith(key + ':')).map(([, value]) => [value.row, value.summary]));
    const grouped = presentTurns(live, { live: !!c?.busy, stopping: !!c?.stopping, state: c?.task?.status,
      error: c?.error || (!c?.busy && c?.task?.errorCode) ? error() : '' }, byTurn);
    return cachedRows(key, [...saved, ...grouped]);
  };
  const modelCanSee = () => catalog()?.options.some(m => m.id === modelChoice(pickerScope())?.modelId && m.imageInput);
  function removeImages(index?: number) {
    files.set(files().filter((asset, i) => {
      if (index !== undefined && i !== index) return true;
      URL.revokeObjectURL(asset.url);
      return false;
    }));
  }
  function attachImages(incoming: File[]) {
    if (!managed() || !controller.current || !incoming.length) return;
    if (goalSelected()) { attachmentError.set('请取消团队目标，再附加图片。'); return; }
    const next = incoming.filter(file => ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)
      && file.size > 0 && file.size <= 5 * 1024 * 1024);
    const room = Math.max(0, 8 - files().length);
    files.set([...files(), ...next.slice(0, room).map(file => ({ file, url: URL.createObjectURL(file) }))]);
    attachmentError.set(next.length !== incoming.length || next.length > room ? '最多附加 8 张 PNG、JPEG、GIF 或 WebP 图片，单张不超过 5 MB。' : '');
  }
  async function stageImages(scope: Scope, batchId: string, images: File[], version: number) {
    try {
      for (const [index, image] of images.entries()) {
        const bytes = new Uint8Array(await image.arrayBuffer());
        for (let offset = 0; offset < bytes.length; offset += 9216) {
          if (disposed || editorVersion !== version) throw Error('stale');
          const data = btoa(String.fromCharCode(...bytes.subarray(offset, offset + 9216)));
          await transport('images.stage', { ...scope, batchId, index, offset, data, mime: image.type });
        }
      }
    } catch (error) {
      if (!disposed) void transport('images.stage', { ...scope, batchId, index: 0, offset: 0, data: '', mime: 'image/png' }).catch(() => {});
      throw error;
    }
  }
  async function modelSettings(params: Calls['models.manage']['params']) {
    const result = await transport('models.manage', params);
    if (!disposed) {
      const next = modelCatalog(result.models);
      catalog.set(next);
      const valid = new Map([...choices()].flatMap(([key, choice]) => {
        const model = next.options.find(m => m.id === choice.modelId);
        if (!model) return [];
        return [[key, model.reasoning?.levels.some(e => e.id === choice.reasoningEffort) ? choice : defaultChoice(model)] as const];
      }));
      choices.set(valid);
    }
    return result;
  }
  const closeArchive = () => { archiveRequest++; archiveProject.set(''); };
  async function openArchive() {
    const projectId = controller.projectId;
    if (!managed() || !projectId || controller.loading) return;
    const request = ++archiveRequest;
    archiveProject.set(projectId);
    archivedSessions.set([]); archivedImported.set([]); archiveError.set(''); archiveLoading.set(true);
    try {
      const { sessions, imported } = await transport('sessions.manage', { action: 'listArchived', projectId });
      if (!disposed && request === archiveRequest && projectId === controller.projectId) {
        archivedSessions.set(sessions);
        archivedImported.set(imported ?? []);
      }
    } catch {
      if (!disposed && request === archiveRequest) archiveError.set('无法读取已归档会话，请重试。');
    } finally {
      if (!disposed && request === archiveRequest) archiveLoading.set(false);
    }
  }
  async function sessionAction(action: SessionAction | 'copy', id: string, name = '') {
    if (sessionPending() || controller.loading || disposed) return;
    const projectId = controller.projectId;
    sessionError.set(''); sessionPending.set(true);
    try {
      if (action === 'copy') { await Clipboard.writeText(id); return; }
      const target = { projectId, sessionId: id };
      const result = await transport('sessions.manage', action === 'rename' ? { ...target, action, title: name } : { ...target, action });
      if (disposed || projectId !== controller.projectId || action === 'reveal') return;
      const selected = result.selectedId || controller.sessionId;
      if (!result.sessions.some(s => s.id === controller.sessionId) || result.selectedId) resetEditor();
      if (action === 'fork' || action === 'restore') {
        if (action === 'restore') closeArchive();
        await controller.selectProject(projectId);
        if (projectId === controller.projectId) controller.selectSession(selected);
      } else {
        controller.sessions = result.sessions;
        sessionDetails.set(result.sessions);
        if (result.sessions.some(s => s.id === selected)) controller.selectSession(selected);
        else if (result.sessions[0]) controller.selectSession(result.sessions[0].id);
        else { controller.sessionId = ''; refresh(); }
      }
      if (action === 'rename') rename.set(null);
    } catch (error) {
      if (!disposed && projectId === controller.projectId) {
        const code = error instanceof Error ? error.message : '';
        if (action === 'restore') archiveError.set(code === 'limit' ? '当前工作区已有 16 个活跃会话，请先归档一个。' : '恢复会话失败，请重试。');
        else sessionError.set(code === 'conflict' ? '任务结束后才能归档或分叉。' : '未能完成会话操作，请重试。');
      }
    } finally { sessionPending.set(false); }
  }
  const layout = () => desktopLayout(windowSize().width, right());
  const title = () => selectedImported()?.title ?? snapshot().sessions.find(s => s.id === snapshot().sessionId)?.title ?? '新会话';
  const status = () => snapshot().current ? `${snapshot().current!.task?.status ?? (snapshot().current!.busy ? 'submitting' : 'idle')} · ${snapshot().current!.busy ? (snapshot().current!.stopping ? '停止请求中，等待收尾' : '读取事件中') : snapshot().current!.drained ? '已排空' : '未确认完成'} · ${snapshot().current!.sequence} 事件` : '加载项目/会话';
  const error = () => snapshot().error || snapshot().current?.error ? `Host/任务错误：${snapshot().error || snapshot().current?.error}；不自动重放。任务结果未确认时请勿重复提交。` : snapshot().current?.task?.errorCode ? `任务错误码：${snapshot().current!.task!.errorCode}` : '';
  const savedImage = signal<string | null>(null);
  let assetRequest = 0;
  function closeSavedImage() {
    assetRequest++;
    const url = savedImage();
    if (url) URL.revokeObjectURL(url);
    savedImage.set(null);
  }
  async function showSavedAsset(asset: ImportedAsset) {
    const scope = controller.current?.scope;
    if (!scope) return;
    closeSavedImage();
    const request = assetRequest;
    const current = () => !disposed && request === assetRequest;
    try {
      const url = await openHistoryAsset(value => transport('sessions.manage', value), scope, asset, current);
      if (url && current()) savedImage.set(url);
      else if (url) URL.revokeObjectURL(url);
    } catch { if (current()) sessionError.set('无法读取该会话附件'); }
  }
  const dispose = () => { disposed = true; closeSavedImage(); removeImages(); queue.clear(); statistics.clear(); outboundChoices.clear(); controller.dispose(); };
  const detach = host.on('desktop.dispose', dispose);
  cleanup(() => { detach(); dispose(); });
  const busy = computed(() => !!snapshot().current?.busy || submitting.has(snapshot().sessionId) || cancelling.has(snapshot().sessionId));
  const blocked = computed(() => disposed || !snapshot().current || snapshot().loading || !!snapshot().current?.error || !!snapshot().error);
  const historyPending = () => !!props.persistentHistory && !selectedHistory();
  const pickerScope = () => { const c = snapshot().current; return c ? scopeKey(c.scope) : ''; };
  const teamGoal = () => teamGoals().get(pickerScope());
  const goalInFlight = () => ['queued', 'running'].includes(teamGoal()?.status ?? '') || !!outboundChoices.get(pickerScope())?.teamGoal;
  const canSelectGoal = () => goalAvailable() && !blocked() && !historyPending() && !busy() && !uploading() && !files().length &&
    !queuedRows().length && (!teamGoal() || teamGoal()?.status === 'completed');
  const canResumeGoal = () => !blocked() && !historyPending() && !busy() &&
    !queuedRows().length && ['paused', 'blocked'].includes(teamGoal()?.status ?? '');
  const queuedRows = computed(() => { queueRevision(); return queue.rows(pickerScope()); });
  const hasQueuedRows = computed(() => queuedRows().length > 0);
  const canEnqueue = () => { queueRevision(); return !blocked() && !historyPending() && busy() && !goalInFlight() && !files().length && !queue.full(pickerScope()) && validTurnText(draft()); };
  const disabled = () => catalog()?.defaultId === 'configure-model' || blocked() || historyPending() || busy() || uploading() || !!queuedRows().length ||
    !(validTurnText(draft()) || (files().length > 0 && !draft().trim())) || (files().length > 0 && !modelCanSee());
  const canStop = () => {
    const { current, sessionId } = snapshot();
    return !blocked() && !!current?.busy && !!current.task && !isTerminal(current.task.status) &&
      !current.stopping && !submitting.has(sessionId) && !cancelling.has(sessionId);
  };
  const pickerDisabled = () => blocked() || busy() || uploading() || !catalog();
  const queueHeld = () => queue.paused(pickerScope()) || !nextTurnReady(snapshot().current);
  const canResume = () => !blocked() && !historyPending() && !busy() && !editTurn() && queuedRows().length > 0 && queueHeld() && nextTurnReady(snapshot().current, true);
  const queueStatus = computed(() => {
    if (snapshot().error || snapshot().current?.error) return '发送状态未确认 · 队列暂停';
    if (canResume()) return '队列已暂停';
    if (editTurn()) return '编辑完成后继续';
    return '';
  });
  function submitTurn(text: string, choice?: ModelChoice, teamGoal?: TeamGoalAction, imageBatch?: string) {
    const sessionId = controller.sessionId, key = pickerScope();
    submitting.add(sessionId);
    outboundChoices.set(key, { choice, teamGoal, imageBatch });
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
  async function send() {
    if (settingsOpen() || selectedImported() || archiveProject() || disposed || disabled()) return;
    if (goalSelected() && !canSelectGoal()) return;
    const images = files().map(asset => asset.file), scope = controller.current!.scope, version = editorVersion;
    const text = draft().trim() ? draft() : '请查看附带的图片。';
    const choice = modelChoice(pickerScope());
    const startGoal = goalSelected();
    let imageBatch: string | undefined;
    if (images.length) {
      imageBatch = `image-${Date.now().toString(36)}-${++nextImageBatch}`;
      uploading.set(true);
      try { await stageImages(scope, imageBatch, images, version); }
      catch { if (version === editorVersion && !disposed) attachmentError.set('图片准备失败，请重新发送。'); return; }
      finally { uploading.set(false); }
      if (disposed || version !== editorVersion || pickerScope() !== scopeKey(scope)) return;
    }
    draft.set(''); removeImages(); attachmentError.set('');
    goalSelected.set(false);
    submitTurn(text, choice, startGoal ? 'start' : undefined, imageBatch);
  }
  function resumeGoal() {
    const goal = teamGoal();
    if (goal && !settingsOpen() && canResumeGoal()) submitTurn(goal.objective, undefined, 'resume');
  }
  function toggleGoal() {
    if (canSelectGoal()) goalSelected.set(!goalSelected());
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
  const resetEditor = () => {
    closeSavedImage(); editorVersion++; draft.set(''); editTurn.set(null); goalSelected.set(false); removeImages(); attachmentError.set('');
    rename.set(null); sessionError.set(''); selectedImported.set(null);
  };
  const project = async (id: string) => {
    closeArchive(); resetEditor();
    if (id !== controller.projectId) visibleImported.set([]);
    await controller.selectProject(id);
  };
  const openImported = (item: ImportedSession) => {
    resetEditor();
    closeArchive();
    right.set(false);
    selectedImported.set(item);
  };
  const session = (id: string) => { resetEditor(); controller.selectSession(id); };
  const create = async () => { resetEditor(); await controller.createSession(); };
  const chooseModel = (choice: ModelChoice) => {
    if (!pickerDisabled()) choices.set(new Map(choices()).set(pickerScope(), choice));
  };
  props.ready?.({ controller, type: text => draft.set(text), send, stop, project, session, create, history: selectedHistory,
    attachImages, chooseModel, toggleGoal, resumeGoal, goal: teamGoal });
  void controller.start();
  const dark = () => colorScheme() === 'dark';
  const ink = () => dark() ? t.dark.ink : t.ink;
  const muted = () => dark() ? '#b7c3dd' : t.muted;
  const button = { borderRadius: 10, padding: 10, backgroundColor: 'transparent' };
  const active = () => !!selectedImported() || !!snapshot().current?.rows.length || !!selectedHistory()?.messages.length;
  const safe = () => styleLayout(active(), artAvailable, titleBarHeight());
  const headingShadow = () => dark() || showHeaderInTrim() ? '0 1px 3px #050b21e6' : '0 1px 3px #f8faffe6';
  const measured = (name: string) => (e: { bounds: Bounds }) => props.onGeometry?.(name, e.bounds);
  const sidebarStyle = () => liveSidebar(artAvailable, dark());
  const footer = () => sidebarFooter(layout().sidebar, true); // this view always renders a project tree
  const popup = () => ({ padding: 5, borderRadius: 11, borderWidth: 1, borderColor: '#9baad0',
    backgroundColor: dark() ? '#18294f' : '#e7edf9', boxShadow: '0 5px 18px #0812344d' });
  const menuLabel = () => ({ fontFamily: t.fontFamily, color: ink(), fontSize: 13 });
  const menuItem = { paddingHorizontal: 8, minHeight: 32, justifyContent: 'center', borderRadius: 6 } as const;
  const showHeaderInTrim = () => managed() && artAvailable && active();
  const headerInk = () => showHeaderInTrim() ? t.sidebarInk : ink();
  const laneInset = () => {
    if (!managed()) return layout().inset;
    const available = windowSize().width - sidebarWidth() - (layout().right ? t.rightWidth : 0);
    return Math.max(layout().compact ? 12 : 24, (available - 964) / 2);
  };
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
          {navigationRows.map(({ icon, label }) => {
            const navStyle = { height: tree.navigationRowHeight, paddingLeft: 4, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'transparent' } as const;
            const content = () => <>
              <DesktopIcon name={icon} color={t.sidebarInk} testID={`icon-nav-${icon}`} onLayout={measured(`icon-nav-${icon}`)} />
              <Text onLayout={measured(`nav-label-${icon}`)} style={{ color: t.sidebarInk, fontFamily: t.fontFamily, fontSize: 14, lineHeight: 22 }}>{label}</Text>
            </>;
            return managed() && icon === 'more' ? <Menu placement="right" margin={8} popupStyle={{ ...popup(), minWidth: 154 }}
              trigger={<Button testID="nav-more" onLayout={measured('nav-more')} accessibilityLabel={label} style={navStyle}
                disabled={snapshot().loading || !snapshot().projectId} hoverStyle={controlHover}>{content()}</Button>}>
              <MenuItem testID="nav-archived-sessions" style={menuItem} hoverStyle={controlHover} onSelect={() => void openArchive()}>
                <Text style={menuLabel()}>已归档会话</Text>
              </MenuItem>
            </Menu> : <Button testID={`nav-${icon}-unavailable`} onLayout={measured(`nav-${icon}`)} accessibilityLabel={label} disabled style={navStyle}>{content()}</Button>;
          })}
        </View>
        <View testID="workspace-heading" onLayout={measured('workspace-heading')} style={{ height: tree.workspaceHeight, flexShrink: 0, flexDirection: 'row', alignItems: 'center', marginTop: -2, marginRight: -8, paddingLeft: 4 }}>
          <Text class="line-clamp-1" style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: '500', fontFamily: t.fontFamily, color: t.goldSoft }}>工作区</Text>
          {workspaceActions.map(({ id, icon, label }) => <Button testID={`${id}-unavailable`} onLayout={measured(id)} accessibilityLabel={label} disabled style={{ width: 32, height: 32, justifyContent: 'center', alignItems: 'center', flexShrink: 0 }}>
            <DesktopIcon name={icon} color={t.goldSoft} testID={`icon-${id}`} onLayout={measured(`icon-${id}`)} />
          </Button>)}
        </View>
        <List testID="projects" each={projects()} estimatedItemSize={126} style={{ flex: 1, minHeight: 0 }}>
          {p => <View testID={`project-group-${p().id}`} onLayout={measured(`project-group-${p().id}`)} style={{ height: projectTreeHeight(selectedProject() === p().id, sessions().length + visibleImported().length) }}>
            <View style={{ height: tree.projectHeight }}>
              {selectedProject() === p().id && <NineSlice name="workspace-ribbon" source={[1185,240]} cuts={[0,145,0,140]} edges={[0,36,0,35]} fill style={{ top: -3, left: -12, right: 0, bottom: -3 }} />}
              <Button testID={`project-${p().name}`} style={{ ...button, height: tree.projectHeight, paddingVertical: 7, paddingLeft: 0, paddingRight: tree.projectTextRightInset, flexDirection: 'row', gap: 4, alignItems: 'center' }} onPress={() => void project(p().id)}>
                {artAvailable ? <View style={{ width: 22, height: 34, flexShrink: 0 }}><Art name="workspace-shield" style={{ top: 0, left: 0, width: 22, height: 34, objectFit: 'contain' }} /></View> : <DesktopIcon name={selectedProject() === p().id ? 'folderOpen' : 'folder'} color={t.goldSoft} testID={`icon-project-${p().id}`} />}
                <Text testID={`project-label-${p().id}`} onLayout={measured(`project-label-${p().id}`)} class="line-clamp-1" style={{ flex: 1, minWidth: 0, fontSize: 15, lineHeight: 20, fontWeight: '500', fontFamily: t.fontFamily, color: selectedProject() === p().id ? '#fff8e8' : '#d7c8a8' }}>{p().name}</Text>
              </Button>
            </View>
            {selectedProject() === p().id && <View testID="sessions" onLayout={measured('sessions')} style={{ height: (sessions().length + visibleImported().length) * tree.sessionHeight }}>
              {sessions().map((item, index) => {
                const activity = () => snapshot().conversations.get(item.id);
                const row = () => sessionTreeState(item, { projectId: selectedProject(), sessionId: selectedSession() }, snapshot().conversations.get(item.id));
                const selected = computed(() => !selectedImported() && row().selected);
                const working = computed(() => row().working);
                const preview = previews.read(item.projectId, item.id);
                const shownAt = signal(Date.now());
                const taskStatus = computed(() => sessionPreviewStatus(activity(), submitting.has(item.id)) || (managed() ? '空闲' : ''));
                const metadata = () => sessionDetails().find(s => s.id === item.id);
                const toolsVisible = () => managed() && (selected() || sessionHover() === item.id || sessionMenu() === item.id);
                const pinned = () => metadata()?.pinned === true;
                const archiveLabel = '归档会话';
                const pinLabel = () => pinned() ? '取消置顶' : '置顶会话';
                const controls = { width: 24, height: 23, alignItems: 'center', justifyContent: 'center', borderRadius: 5 } as const;
                const previewInk = { fontFamily: t.fontFamily, color: '#d3d3d7', fontSize: 12, lineHeight: 17 };
                const last = index === sessions().length - 1 && visibleImported().length === 0;
                const mid = tree.sessionHeight / 2;
                return <View onMouseEnter={() => sessionHover.set(item.id)} onMouseLeave={() => sessionHover.set('')}
                    style={{ height: tree.sessionHeight }}>
                  <View testID={`branch-stem-${item.id}`} style={{ position: 'absolute', pointerEvents: 'none', left: tree.branchX, top: 0, height: last ? mid : tree.sessionHeight, borderLeftWidth: 1, borderStyle: 'dashed', borderColor: '#dfcc9a99' }} />
                  <View style={{ position: 'absolute', pointerEvents: 'none', left: tree.branchX, top: mid, width: tree.branchWidth, borderTopWidth: 1, borderStyle: 'dashed', borderColor: '#dfcc9a99' }} />
                  <Button testID={`session-${item.title}`} onLayout={measured(`session-row-${item.id}`)} selected={selected()} accessibilityLabel={`${item.title}${working() ? '，任务处理中' : ''}`} style={{ height: tree.sessionHeight - 4, marginTop: 2, marginLeft: tree.branchX + tree.branchWidth, paddingLeft: 10, paddingRight: toolsVisible() ? 80 : 9, justifyContent: 'center', borderRadius: 6, borderWidth: 1, borderColor: selected() ? '#e2be70b8' : 'transparent', backgroundImage: selected() ? 'linear-gradient(90deg, #526fb879, #2b468b55 72%, #142a5e38)' : undefined, backgroundColor: 'transparent' }} hoverStyle={controlHover} onPress={() => session(item.id)}
                    tooltip={<Tooltip testID={`session-preview-${item.id}`} placement="right" align="start" offset={18} margin={8} delay={500}
                      onOpen={() => shownAt.set(Date.now())}
                      style={{ width: 244, padding: 14, gap: 6, borderRadius: 12, backgroundColor: '#29292b', boxShadow: '0 4px 14px #00000030' }}>
                      <Text style={{ ...previewInk, color: '#fff', fontSize: 14, fontWeight: '500', lineHeight: 20, numberOfLines: 3 }}>{item.title}</Text>
                      {preview && <Text style={{ ...previewInk, numberOfLines: 2, textOverflow: 'ellipsis-middle' }}>{metadata()?.preview?.workspacePath ?? preview.workspaceLabel}</Text>}
                      {preview && <Text style={previewInk}>{sessionAge(preview.createdAt, shownAt())}</Text>}
                      {taskStatus() && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                        {managed() && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: working() ? '#e5ca8c' : '#aeb8cd' }} />}
                        <Text style={previewInk}>{taskStatus()}</Text>
                      </View>}
                    </Tooltip>}>
                    <Text testID={`session-label-${item.id}`} class="line-clamp-1" style={{ fontSize: 13, fontFamily: t.fontFamily, color: selected() ? '#fff8e8' : '#d7c8a8' }}>{item.title}</Text>
                  </Button>
                  {toolsVisible() && <View style={{ position: 'absolute', right: 5, top: 5, flexDirection: 'row', gap: 2 }}>
                    <Menu placement="right" margin={8} popupStyle={{ ...popup(), minWidth: 172 }}
                      onOpenChange={e => sessionMenu.set(e.open ? item.id : '')}
                      trigger={<Button style={controls} hoverStyle={controlHover} focusVisibleStyle={controlFocus}
                        testID={`session-menu-${item.id}`} accessibilityLabel="会话操作">
                        <DesktopIcon name="ellipsis" size={14} color={t.sidebarInk} />
                      </Button>}>
                      {([
                        ['pin', pinLabel()], ['rename', '重命名'], ['fork', '分叉会话'],
                        ['copy', '复制 Session ID'], ['reveal', '在 Finder 中显示'], ['archive', archiveLabel],
                      ] as const).map(([action, label]) => <>
                        {(action === 'copy' || action === 'archive') && <MenuSeparator style={{ height: 1, marginVertical: 3, backgroundColor: '#97a5c77f' }} />}
                        <MenuItem testID={`session-action-${action}`} style={menuItem} hoverStyle={controlHover}
                          disabled={sessionPending() || ((action === 'archive' || action === 'fork') && working())}
                          onSelect={() => {
                            if (action === 'rename') {
                              renameTitle.set(item.title); rename.set(item.id);
                              setTimeout(() => { if (rename() === item.id) { renameInput?.focus(); renameInput?.setSelection(0, item.title.length); } }, 0);
                            } else void sessionAction(action, item.id);
                          }}>
                          <Text style={menuLabel()}>{label}</Text>
                        </MenuItem>
                      </>)}
                    </Menu>
                    {([['archive', archiveLabel, 'archive'], ['pin', pinLabel(), 'pin']] as const).map(([action, label, icon]) =>
                      <Button testID={`session-quick-${action}-${item.id}`} accessibilityLabel={label} style={controls}
                        disabled={sessionPending() || (action === 'archive' && working())}
                        hoverStyle={controlHover} focusVisibleStyle={controlFocus}
                        tooltip={<Tooltip placement="bottom" offset={5} delay={450} style={{ backgroundColor: '#29292b', borderRadius: 6, padding: 6 }}>
                          <Text style={{ ...previewInk, color: '#fff' }}>{label}</Text></Tooltip>}
                        onPress={() => void sessionAction(action, item.id)}>
                        <DesktopIcon name={icon} size={13} color={action === 'pin' && pinned() ? t.goldSoft : t.sidebarInk} />
                      </Button>)}
                  </View>}
                  {working() && <SessionActivity id={item.id} onLayout={measured(`session-activity-${item.id}`)} />}
                </View>;
              })}
              {visibleImported().map((item, index) => {
                const selected = () => selectedImported()?.id === item.id;
                const last = index === visibleImported().length - 1;
                const mid = tree.sessionHeight / 2;
                return <View style={{ height: tree.sessionHeight }}>
                  <View style={{ position: 'absolute', pointerEvents: 'none', left: tree.branchX, top: 0,
                    height: last ? mid : tree.sessionHeight, borderLeftWidth: 1, borderStyle: 'dashed', borderColor: '#dfcc9a99' }} />
                  <View style={{ position: 'absolute', pointerEvents: 'none', left: tree.branchX, top: mid,
                    width: tree.branchWidth, borderTopWidth: 1, borderStyle: 'dashed', borderColor: '#dfcc9a99' }} />
                  <Button testID={`imported-session-${item.id}`} accessibilityLabel={item.title} selected={selected()}
                    style={{ height: tree.sessionHeight - 4, marginTop: 2, marginLeft: tree.branchX + tree.branchWidth,
                      paddingHorizontal: 10, justifyContent: 'center', borderRadius: 6, borderWidth: 1,
                      borderColor: selected() ? '#e2be70b8' : 'transparent', backgroundColor: selected() ? '#526fb879' : 'transparent' }}
                    hoverStyle={controlHover} onPress={() => openImported(item)}>
                    <Text class="line-clamp-1" style={{ fontSize: 13, fontFamily: t.fontFamily, color: selected() ? '#fff8e8' : '#d7c8a8' }}>{item.title}</Text>
                  </Button>
                </View>;
              })}
            </View>}
          </View>}
        </List>
        {showCharacters() && footer().mascotVisible && <Art testID="sidebar-mascot" name="chibi" style={{ left: layout().sidebar * .52 - footer().mascotWidth / 2, bottom: footer().mascotBottom, width: footer().mascotWidth, height: Math.min(260, windowSize().height * .38), objectFit: 'contain', objectPosition: 'center bottom', opacity: .22, filter: 'brightness(1.08) contrast(1.04)' }} />}
        <View testID="sidebar-footer" onLayout={measured('sidebar-footer')} style={{ height: footer().height, flexShrink: 0, marginHorizontal: -16, marginBottom: -16, zIndex: managed() ? 5 : undefined }}>
          <Art testID="sidebar-swag" name="sidebar-swag" style={{ top: 0, left: 0, right: 0, height: footer().swagHeight, objectFit: 'fill', filter: 'brightness(1.1) saturate(1.04) contrast(1.04)' }} />
          <Button testID="settings-trigger" onLayout={measured('sidebar-settings')} accessibilityLabel="设置" onPress={() => settingsOpen.set(true)}
            hoverStyle={controlHover} activeStyle={controlPressed} focusVisibleStyle={controlFocus}
            style={{ ...controlSurface, marginTop: footer().settingsTop, marginHorizontal: footer().settingsInset,
              height: footer().settingsHeight, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 20 }}>
            <DesktopIcon name="settings" color={t.sidebarInk} testID="icon-settings" />
            <Text style={{ color: t.sidebarInk, fontSize: 14, fontFamily: t.fontFamily }}>设置</Text>
          </Button>
        </View>
      </View>}
      <View testID="chat-column" onLayout={measured('chat-column')} style={{ flex: 1, minWidth: 0 }}>
        <TopTrim active={active()} />
        <View testID="header-safe-area" onLayout={measured('header-safe-area')} style={{ height: showHeaderInTrim() ? Math.max(titleBarHeight(), 20) : safe().headerTop, flexShrink: 0 }} />
        <View testID="chat-header" onLayout={measured('chat-header')} style={{ zIndex: 2, height: showHeaderInTrim() ? 77 - Math.max(titleBarHeight(), 20) : safe().headerBody,
          flexShrink: 0, paddingHorizontal: managed() ? 26 : layout().inset, paddingTop: showHeaderInTrim() ? 0 : 4, gap: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text testID="chat-title" onLayout={measured('chat-title')} class="line-clamp-1" style={{ flex: 1, minWidth: 0, color: headerInk(), textShadow: headingShadow(), fontFamily: t.fontFamily, fontSize: showHeaderInTrim() ? 14 : layout().compact ? 16 : 18, lineHeight: 24, fontWeight: '600' }}>{title()}</Text>
            {!selectedImported() && <Button testID="toggle-details" style={{ padding: 6, flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 4 }} disabled={windowSize().width < 1100} onPress={() => right.set(!right())}>
              <Text style={{ fontFamily: t.fontFamily, fontSize: 12, color: headerInk(), textShadow: headingShadow() }}>{layout().right ? '收起详情' : '任务详情'}</Text>
              <DesktopIcon name="panel" mirror color={headerInk()} size={14} testID="icon-details" />
            </Button>}
          </View>
          {!showHeaderInTrim() && <Text testID="selection" onLayout={measured('selection')} class="line-clamp-1" style={{ maxWidth: '100%', fontFamily: t.fontFamily, fontSize: 11, lineHeight: 16, color: headerInk(), textShadow: headingShadow(), alignSelf: 'flex-start' }}>{`项目 ${snapshot().projects.find(p => p.id === snapshot().projectId)?.name ?? '—'}`}</Text>}
        </View>
        <View testID="chat-body" onLayout={measured('chat-body')} style={{ flex: 1, minHeight: 0, paddingHorizontal: laneInset(), paddingTop: managed() ? 4 : 12, paddingBottom: safe().bottom, gap: 8 }}>
          {selectedImported() ? <DesktopImportedHistory dark={dark()} projectId={selectedProject()} sessionId={selectedImported()!.id}
            load={request => transport('sessions.manage', request)} /> : <>
          {!managed() && <Text testID="status" style={{ fontFamily: t.fontFamily, fontSize: 12, color: muted() }}>{status()}</Text>}
          {!!((!managed() || snapshot().error) && error() || sessionError()) && <View testID="error" style={{ alignSelf: 'flex-start', maxWidth: '100%', borderRadius: 9,
            paddingHorizontal: 10, paddingVertical: 6, backgroundColor: dark() ? t.dark.assistant : t.paper, borderWidth: 1, borderColor: '#ab324868' }}>
            <Text style={{ fontFamily: t.fontFamily, color: dark() ? '#ffc1cb' : t.danger, fontSize: 13 }}>{sessionError() || error()}</Text>
          </View>}
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
          {!active() && (!props.persistentHistory || historyState() === 'ready') && !managed() && <View testID="empty-state" style={{ padding: layout().compact ? 14 : 24, gap: 10, flexShrink: 0, backgroundColor: dark() ? t.dark.glass : t.glass, backdropFilter: 'blur(8px)', borderRadius: 14 }}><Text style={{ fontFamily: t.fontFamily, fontSize: layout().compact ? 20 : 27, lineHeight: layout().compact ? 24 : 32, fontWeight: '600', color: ink() }}>从一个真实任务开始</Text><Text style={{ fontFamily: t.fontFamily, fontSize: t.font, lineHeight: t.lineHeight, color: muted() }}>选择项目与会话后发送消息。这里只展示 Host 返回的公开文本、工具动作与任务状态；没有预填任务结果。</Text></View>}
          <List testID="messages" onLayout={measured('messages')} onScroll={props.onMessageScroll} each={messageRows()} keyExtractor={(row, index) => row.key ?? String(index)} scrollbar={managed() ? { mode: 'hover', motion: { idle: 0, enter: 90, exit: 120 }, vertical: { thumbStyle: { backgroundColor: '#768eb67f' } } } : undefined} initialScrollAtEnd maintainVisibleContentPosition={{ autoscrollToBottomThreshold: 48 }} estimatedItemSize={88} contentStyle={{ paddingBottom: 12 }} style={{ flex: 1, minHeight: 0 }}>
            {(r, index) => {
              const groupKey = () => pickerScope() + ':' + (r().key ?? index());
              const expanded = () => openGroups().has(groupKey());
              const toggleGroup = () => {
                const key = groupKey(), next = new Set(openGroups());
                if (next.has(key)) next.delete(key); else next.add(key);
                openGroups.set(next);
              };
              const activity = computed(() => r().role === '执行过程' ? JSON.parse(r().body) as TurnActivity : null);
              const activityTitle = () => {
                const turn = activity();
                return turn && [turn.state, turn.categories.join('、'), turn.count ? `${turn.count} 项操作` : ''].filter(Boolean).join(' · ');
              };
              const filesChanged = () => r().changes;
              const disclosure = () => !!activity() || r().role === '工作区变化';
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
                width: disclosure() || filesChanged() ? messageWidth() : 'fit-content', maxWidth: messageWidth(), alignSelf: user() ? 'flex-end' : 'flex-start',
                marginBottom: tool() || disclosure() ? 8 : 12, paddingVertical: tool() || disclosure() ? 7 : 14, paddingHorizontal: tool() || disclosure() ? 11 : 18, gap: 6,
                borderRadius: disclosure() ? 10 : tool() ? 8 : 18, borderBottomLeftRadius: disclosure() ? 10 : tool() ? 8 : user() ? 18 : 7,
                borderBottomRightRadius: disclosure() ? 10 : tool() ? 8 : user() ? 7 : 18,
                borderWidth: 1, borderColor: activity()?.error ? '#ab324868' : tool()?.edge ?? (user() ? '#c5a4687a' : dark() ? '#d3b47766' : t.line),
                backgroundColor: disclosure() ? (dark() ? t.dark.glass : t.glass) :
                  tool()?.surface ?? (user() ? (dark() ? t.dark.user : '#e8edf9f2') : (dark() ? t.dark.assistant : t.paper)),
                backgroundImage: tool()?.gradient,
                boxShadow: tool() || disclosure() ? undefined : (user() ? t.userShadow : dark() ? '0 4px 16px #00000038' : t.assistantShadow),
              }}>
                {r().role === '会话附件' ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {(JSON.parse(r().body) as ImportedAsset[]).map(asset =>
                    <Button testID={`history-asset-${asset.id}`} accessibilityLabel={asset.name} style={menuItem}
                      hoverStyle={controlHover} disabled={!asset.bytes} onPress={() => void showSavedAsset(asset)}>
                      <Text style={menuLabel()}>{asset.bytes ? asset.name : asset.name + '（文件缺失）'}</Text>
                    </Button>)}
                </View> : activity() ? <>
                  <Button testID="turn-process" onPress={toggleGroup} accessibilityLabel={`${expanded() ? '收起' : '展开'}执行过程，${activityTitle()}`}
                    style={{ minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 7 }} hoverStyle={controlHover}>
                    <DesktopIcon name={expanded() ? 'chevronDown' : 'chevronRight'} size={12} color={muted()} />
                    <Text class="line-clamp-1" style={{ ...menuLabel(), flex: 1, minWidth: 0, color: activity()?.error ? (dark() ? '#ffc1cb' : t.danger) : muted() }}>{activityTitle()}</Text>
                  </Button>
                  {expanded() && <View testID="turn-activity-details" style={{ gap: 6, paddingLeft: 18, paddingVertical: 3 }}>
                    {activity()!.operations.map(step => <Text style={{ ...menuLabel(), color: step.kind === 'tool' ?
                      toolCard('工具', step.body, dark())?.color : ink() }}>
                      {step.kind === 'tool' ? toolCard('工具', step.body, dark())?.label : step.body}
                    </Text>)}
                    {!!activity()!.error && <Text testID="turn-error" style={{ ...menuLabel(), color: dark() ? '#ffc1cb' : t.danger }}>{activity()!.error}</Text>}
                  </View>}
                </> : r().role === '工作区变化' ? null : tool() ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <DesktopIcon name={tool()?.phase === 'error' ? 'toolError' : tool()?.phase === 'end' ? 'toolDone' : 'toolStart'} size={12} color={tool()?.color ?? muted()} testID="icon-tool" />
                  <Text style={{ flexShrink: 1, minWidth: 0, fontSize: 12, lineHeight: 18, fontFamily: t.fontFamily, color: tool()?.color }}>{tool()?.label ?? ''}</Text>
                </View> : <>
                  {r().role !== '你' && r().role !== 'PI 公开文本' && <Text style={{ fontSize: 12, fontFamily: t.fontFamily, color: muted() }}>{r().role}</Text>}
                  <TextView styles={{ root: { color: ink(), fontFamily: t.fontFamily, fontSize: t.font, lineHeight: t.lineHeight }, code: { fontFamily: t.monoFont }, codeBlockCode: { fontFamily: t.monoFont } }} markdown={r().body} selectable />
                </>}
                {filesChanged() && <View testID="workspace-changes" style={{ gap: 6, ...(r().role !== '工作区变化' && {
                    borderTopWidth: 1, borderColor: t.line, paddingTop: 9, marginTop: 6,
                  }) }}>
                  <Text style={{ ...menuLabel(), fontWeight: '600' }}>{filesChanged()!.files.length ? `已改动 ${filesChanged()!.files.length} 个文件` : '改动文件'}</Text>
                  {filesChanged()!.files.slice(0, expanded() ? undefined : 3).map(file =>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ ...menuLabel(), color: muted(), minWidth: 28, fontSize: 12 }}>{file.summary}</Text>
                      <Text class="line-clamp-2" style={{ ...menuLabel(), flex: 1, minWidth: 0 }}>{file.path}</Text>
                    </View>)}
                  {filesChanged()!.files.length > 3 && <Button testID="workspace-changes-more" onPress={toggleGroup} accessibilityLabel={expanded() ? '收起改动文件' : '显示更多改动文件'}
                    style={{ alignSelf: 'flex-start', minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 5 }} hoverStyle={controlHover}>
                    <DesktopIcon name={expanded() ? 'chevronDown' : 'chevronRight'} size={12} color={muted()} />
                    <Text style={{ ...menuLabel(), color: muted() }}>{expanded() ? '收起文件' : `再显示 ${filesChanged()!.files.length - 3} 个文件`}</Text>
                  </Button>}
                  {filesChanged()?.limited && <Text style={{ ...menuLabel(), color: muted() }}>部分改动超出显示范围</Text>}
                </View>}
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
            {teamGoal() && <View testID="team-goal-status" onLayout={measured('team-goal-status')} style={{ flexShrink: 0, padding: 8, marginBottom: 10, gap: 4,
              borderRadius: 8, backgroundColor: dark() ? t.dark.glass : t.glass }}>
              <Text style={{ fontFamily: t.fontFamily, color: ink(), fontSize: 12 }}>
                {`团队目标 · ${teamGoalStatuses[teamGoal()!.status]}${teamGoal()!.round ? ` · 第 ${teamGoal()!.round} 轮` : ''}${teamGoal()!.status === 'running' ? ` · ${teamGoalPhases[teamGoal()!.phase]}` : ''}`}
              </Text>
              <Text style={{ fontFamily: t.fontFamily, color: muted(), fontSize: 12, numberOfLines: 2 }}>{teamGoal()!.objective}</Text>
              {teamGoal()!.toolPreviewLimited && <Text style={{ fontFamily: t.fontFamily, color: muted(), fontSize: 12 }}>聊天仅显示部分工具事件，完整事件已存入任务记录。</Text>}
              {teamGoal()!.status === 'blocked' && <Text style={{ fontFamily: t.fontFamily, color: muted(), fontSize: 12 }}>
                {teamGoal()!.errorCode === 'timeout' ? '已达到本次执行时限，可继续目标。' : '完整目标尚未通过独立验收，可根据现有成果继续。'}
              </Text>}
            </View>}
            <View testID="composer" onLayout={measured('composer')} style={{ height: safe().composerHeight + (files().length ? 38 : 0), flexShrink: 0, paddingHorizontal: safe().composerPaddingX, paddingBottom: safe().composerPaddingBottom, paddingTop: safe().composerPaddingTop, gap: 8, borderRadius: clamp(26, windowSize().width * .02, 34), backgroundColor: t.composerBase, backgroundImage: dark() ? t.darkComposerGradient : t.composerGradient, backdropFilter: 'blur(8px) saturate(.88)', boxShadow: t.composerShadow }}>
              {artAvailable && <NineSlice testID="composer-frame" name="composer-frame" source={[1800,588]} cuts={[170,120,115,120]} edges={[72,54,52,54]} topCenter={360} onLayout={measured('composer-frame')} onCenterLayout={measured('composer-bow')} style={{ top: -20, left: -14, right: -14, bottom: -18, zIndex: 1 }} />}
              <Input testID="prompt" onLayout={measured('prompt')} accessibilityLabel="任务输入" style={{ minHeight: 32, flex: 1, zIndex: 2, fontFamily: t.fontFamily, fontSize: t.font, backgroundColor: 'transparent', color: t.composerInk, caretColor: t.caret, placeholderColor: t.placeholder }} placeholder="发消息或创建任务" autoCapitalize="none" autoCorrect={false} maxLength={4096} value={draft()} onChange={e => draft.set(e.value)} onPaste={e => attachImages(e.files)}
                disabled={uploading()} onSubmit={() => void send()} />
              {!!files().length && <View testID="composer-attachments" style={{ zIndex: 2, flexDirection: 'row', alignItems: 'center', gap: 3, height: 30 }}>
                {files().map((asset, index) => <Button testID={`remove-image-${index}`} accessibilityLabel={`移除第 ${index + 1} 张图片`}
                  disabled={uploading()} onPress={() => removeImages(index)}
                  style={{ ...controlSurface, paddingHorizontal: 4, height: 30, flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                  <Image src={asset.url} style={{ width: 22, height: 22, borderRadius: 3, objectFit: 'cover' }} />
                  <Text style={{ color: t.composerInk, fontFamily: t.fontFamily, fontSize: 12 }}>×</Text>
                </Button>)}
                <Text style={{ color: t.composerInk, fontFamily: t.fontFamily, fontSize: 12, flexShrink: 1, numberOfLines: 1 }}>
                  {uploading() ? '正在准备图片…' : modelCanSee() ? `${files().length} 张图片` : '请选择支持图片的模型'}
                </Text>
              </View>}
              <View testID="composer-actions" onLayout={measured('composer-actions')} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, zIndex: 2, height: safe().composerActionHeight, flexShrink: 0 }}>
                {managed() && <Menu testID="composer-add-menu" placement="top" offset={9} margin={12} popupStyle={{ ...popup(), minWidth: 172 }}
                  trigger={<Button testID="composer-add" onLayout={measured('composer-add')} accessibilityLabel="添加或切换模式"
                    style={{ ...controlSurface, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
                      borderWidth: 1, borderColor: '#ddc083', backgroundColor: goalSelected() ? t.accent : '#dde5f5dc' }}
                    hoverStyle={{ backgroundColor: goalSelected() ? '#7491cb' : '#eff4ff' }}
                    activeStyle={{ backgroundColor: '#aabbdf' }} focusVisibleStyle={{ borderColor: '#f3ddb2' }}>
                    <DesktopIcon name="plus" size={16} color={goalSelected() ? '#fffaf0' : '#25395e'} />
                  </Button>}>
                  <MenuItem testID="team-goal-toggle" onLayout={measured('team-goal-toggle')} checked={goalSelected()} disabled={!canSelectGoal()}
                    onSelect={toggleGoal} style={menuItem} hoverStyle={controlHover}>
                    <Text style={menuLabel()}>团队目标</Text>
                  </MenuItem>
                  {canResumeGoal() && <MenuItem testID="team-goal-resume-menu" onSelect={resumeGoal} style={menuItem} hoverStyle={controlHover}>
                    <Text style={menuLabel()}>继续团队目标</Text>
                  </MenuItem>}
                </Menu>}
                {goalSelected() && <Text testID="team-goal-selected" style={{ fontFamily: t.fontFamily, color: t.goldSoft, fontSize: 12 }}>团队目标</Text>}
                <View style={{ flex: 1, minWidth: 0 }} />
                {canResumeGoal() && <Button testID="team-goal-resume" accessibilityLabel="继续团队目标" onPress={resumeGoal}
                  onLayout={measured('team-goal-resume')}
                  hoverStyle={controlHover} activeStyle={controlPressed} focusVisibleStyle={controlFocus}
                  style={{ ...controlSurface, flexShrink: 0, paddingHorizontal: 8, height: 32, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontFamily: t.fontFamily, color: t.composerInk, fontSize: 12 }}>继续目标</Text>
                </Button>}
                {busy() && <Button testID="queue-submit" accessibilityLabel="排队发送" onPress={enqueue} disabled={!canEnqueue()}
                  hoverStyle={controlHover} activeStyle={controlPressed} focusVisibleStyle={controlFocus} disabledStyle={{ opacity: .48 }}
                  style={{ ...controlSurface, flexShrink: 0, height: 32, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontFamily: t.fontFamily, color: t.composerInk, fontSize: 12 }}>排队发送</Text>
                </Button>}
                <DesktopModelPicker scope={pickerScope()} models={catalog()?.options ?? []} choice={modelChoice(pickerScope())}
                  disabled={pickerDisabled()} dark={dark()} art={artAvailable} onLayout={measured('model-picker')} onPopupLayout={measured('model-popup')}
                  onChange={chooseModel} />
                <Button testID="primary-action" onLayout={measured('primary-action')} accessibilityLabel={busy() ? goalInFlight() ? '暂停团队目标' : '停止生成' : '发送'} style={{ width: safe().composerActionHeight, height: safe().composerActionHeight, borderRadius: safe().composerActionHeight / 2, backgroundColor: t.accent, backgroundImage: t.sendGradient, borderWidth: 1, borderColor: '#e1cfaad1', boxShadow: '0 4px 12px #1a326c47', justifyContent: 'center', alignItems: 'center', flexShrink: 0 }} disabled={busy() ? !canStop() : disabled()} disabledStyle={{ opacity: .48 }} onPress={() => busy() ? stop() : send()}><DesktopIcon name={busy() ? 'stop' : 'send'} color="#fffaf0" size={16} testID={busy() ? 'icon-stop' : 'icon-send'} /></Button>
              </View>
            </View>
          </View>
          {!!attachmentError() && <Text testID="attachment-error" style={{ alignSelf: 'center', backgroundColor: dark() ? t.dark.glass : t.paper,
            borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4, fontFamily: t.fontFamily, color: ink(), fontSize: 12 }}>{attachmentError()}</Text>}
          {showStatistics() && <DesktopComposerStatistics scope={pickerScope()} data={statistics.read(snapshot().current?.scope)} dark={dark()} art={artAvailable}
            height={safe().previewHeight} onLayout={measured('composer-statistics')} onTriggerLayout={measured('round-statistics')}
            onMetricsLayout={measured('statistics-metrics')} onPopupLayout={measured('statistics-popup')} />}
          </>}
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
      {!!archiveProject() && <Dialog testID="archived-sessions" accessibilityLabel="已归档会话" animation="none"
        onOpenChange={e => { if (!e.open) closeArchive(); }}
        style={{ ...popup(), position: 'absolute', left: Math.max(8, (windowSize().width - 440) / 2),
          width: Math.min(windowSize().width - 16, 440), top: Math.max(8, (windowSize().height - 390) / 2),
          height: Math.min(windowSize().height - 16, 390), padding: 14, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ ...menuLabel(), flex: 1, fontSize: 17, fontWeight: '600' }}>已归档会话</Text>
          <Button style={menuItem} accessibilityLabel="关闭已归档会话" testID="archived-sessions-close" onPress={closeArchive}>
            <Text style={menuLabel()}>关闭</Text>
          </Button>
        </View>
        <Text style={menuLabel()}>{snapshot().projects.find(p => p.id === archiveProject())?.name}</Text>
        {archiveLoading() && <Text style={menuLabel()}>正在加载…</Text>}
        {!archiveLoading() && !archiveError() && !archivedSessions().length && !archivedImported().length && <Text style={menuLabel()}>这个工作区没有已归档会话</Text>}
        {!!archiveError() && <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Text style={{ ...menuLabel(), flex: 1 }}>{archiveError()}</Text>
          {!archivedSessions().length && <Button style={menuItem} onPress={() => void openArchive()}><Text style={menuLabel()}>重试</Text></Button>}
        </View>}
        <Scroll testID="archived-session-list" style={{ flex: 1, minHeight: 0 }} contentStyle={{ gap: 5 }}>
          {archivedImported().map(item => <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 6,
            borderBottomWidth: 1, borderColor: '#97a5c77f' }}>
            <Text class="line-clamp-2" style={{ ...menuLabel(), flex: 1, minWidth: 0 }}>{item.title}</Text>
            <Button testID={`view-archived-${item.id}`} accessibilityLabel={`查看 ${item.title}`}
              style={{ ...controlSurface, ...menuItem }} hoverStyle={controlHover} focusVisibleStyle={controlFocus} onPress={() => openImported(item)}>
              <Text style={menuLabel()}>查看</Text>
            </Button>
          </View>)}
          {archivedSessions().map(item => <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 6,
            borderBottomWidth: 1, borderColor: '#97a5c77f' }}>
            <Text class="line-clamp-2" style={{ ...menuLabel(), flex: 1, minWidth: 0 }}>{item.title}</Text>
            <Button testID={`restore-session-${item.id}`} accessibilityLabel={`恢复并打开 ${item.title}`}
              disabled={sessionPending()} onPress={() => void sessionAction('restore', item.id)}
              style={{ ...controlSurface, ...menuItem }} hoverStyle={controlHover} focusVisibleStyle={controlFocus}>
              <Text style={menuLabel()}>恢复并打开</Text>
            </Button>
          </View>)}
        </Scroll>
      </Dialog>}
      {rename() && <Dialog testID="rename-session-dialog" accessibilityLabel="重命名会话" animation="none"
        onOpenChange={e => { if (!e.open) rename.set(null); }}
        style={{ ...popup(), position: 'absolute', left: Math.max(8, (windowSize().width - 360) / 2),
          width: Math.min(windowSize().width - 16, 360), top: Math.max(8, (windowSize().height - 140) / 2), padding: 14, gap: 10 }}>
        <Text style={menuLabel()}>重命名会话</Text>
        <Input ref={value => { renameInput = value; }} autoFocus testID="rename-session-input"  accessibilityLabel="会话名称" value={renameTitle()} maxLength={100}
          style={{ ...controlSurface, ...menuLabel(), height: 34, paddingHorizontal: 8 }}
          onChange={e => renameTitle.set(e.value)}
          onSubmit={() => { const active = rename(); if (active && renameTitle().trim()) void sessionAction('rename', active, renameTitle()); }} />
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
          <Button style={menuItem} onPress={() => rename.set(null)}><Text style={menuLabel()}>取消</Text></Button>
          <Button testID="rename-session-save" style={{ ...controlSurface, ...menuItem }}
            disabled={sessionPending() || !renameTitle().trim()} onPress={() => void sessionAction('rename', rename()!, renameTitle())}>
            <Text style={menuLabel()}>保存</Text>
          </Button>
        </View>
      </Dialog>}
      {savedImage() && <Dialog testID="history-asset-preview" accessibilityLabel="会话图片" animation="none"
        onOpenChange={event => { if (!event.open) closeSavedImage(); }}
        style={{ ...popup(), position: 'absolute', left: '12%', top: '10%', width: '76%', height: '80%', gap: 8, padding: 12 }}>
        <Button testID="history-asset-close" style={menuItem} hoverStyle={controlHover} onPress={closeSavedImage}>
          <Text style={menuLabel()}>关闭图片</Text>
        </Button>
        <Image src={savedImage()!} style={{ width: '100%', flex: 1, objectFit: 'contain' }} />
      </Dialog>}
      {settingsOpen() && <DesktopSettings onClose={() => settingsOpen.set(false)} dark={dark()} art={artAvailable}
        appearance={appearance()} onAppearance={changeAppearance} characters={showCharacters()} onCharacters={showCharacters.set}
        statistics={showStatistics()} onStatistics={showStatistics.set} defaultModel={defaultModelLabel()} onModels={managed() ? modelSettings : undefined} onLayout={measured('settings-content')} />}
    </View>
  );
}
