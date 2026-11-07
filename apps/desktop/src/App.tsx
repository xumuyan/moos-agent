import { useCallback, useEffect, useRef, useState } from 'react';
import { Sender } from '@ant-design/x';
import { Alert, Badge, Button, ConfigProvider, Empty, Modal, Select, Space, Tag, Tooltip } from 'antd';
import { ArrowUpOutlined, CodeOutlined, DeleteOutlined, FolderOpenOutlined, MessageOutlined, PlusOutlined, StopOutlined, LayoutOutlined, AppstoreOutlined, BarChartOutlined } from '@ant-design/icons';
import zhCN from 'antd/locale/zh_CN';
import { request } from './api';
import { emptySnapshot, isActive, type Snapshot } from './types';
import Settings from './Settings';
import moosIcon from './moos-icon.png';
import { useHistory } from './useHistory';
import HistoryControls from './HistoryControls';
import AppShell from './layout/AppShell';
import WorkspaceSidebar from './layout/Sidebar';
import ConversationList from './layout/ConversationList';
import ProjectRail from './layout/ProjectRail';
import ConversationPane from './layout/ConversationPane';
import RightPanel from './layout/RightPanel';
import ConversationTranscript from './conversation/ConversationTranscript';
import ConversationScroll from './conversation/ConversationScroll';
import ComposerDock from './layout/ComposerDock';
import PermissionMenu from './composer/PermissionMenu';
import ComposerStatus from './composer/ComposerStatus';
import { createBuiltinPluginRegistry } from './builtin-plugins/insights';
import { PluginProvider, SlotHost } from './plugins/slots';
import { BUILTIN_THEMES } from './themes/builtin';
import { applyTheme, loadSavedTheme, resetTheme, initializeWorkbenchTheme, THEME_STORAGE_KEY } from './themes/loader';
import { useLocalPlugins } from './plugins/useLocalPlugins';
import TaskTrajectory from './conversation/TaskTrajectory';
import { createWorkspaceView } from './ui-adapter/snapshot';
import { executeUiCommand, uiCommands, type UiCommand } from './ui-adapter/commands';
import './theme/tokens.css';
import './theme/shell.css';
import './style.css';

import './theme/dsh/tokens.css';
import './theme/dsh/shell.css';
import './theme/dsh/conversation.css';
import './theme/dsh/composer.css';
import './theme/dsh/settings.css';

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
export default function App() {
  const [data, setData] = useState<Snapshot>(emptySnapshot);
  const [projectId, setProjectId] = useState('');
  const [conversationId, setConversationId] = useState('');
  const [providerId, setProviderId] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ message: string; scope: string }>();
  // Errors belong to the selection that initiated the command, including late replies.
  const noticeScope = JSON.stringify([projectId, conversationId, providerId]);
  const error = notice?.scope === noticeScope ? notice.message : '';
  const setError = (message: string) => setNotice(message ? { message, scope: noticeScope } : undefined);
  useEffect(() => { setNotice(undefined); }, [noticeScope]);
  const [connectionError, setConnectionError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState(false);
  const [settingsSection, setSettingsSection] = useState<'models' | 'plugins' | 'usage'>('models');
  const openSettings = (section: 'models' | 'plugins' | 'usage') => { setSettingsSection(section); setSettings(true); };
  const [rightOpen, setRightOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string>();
  const [pluginRegistry] = useState(createBuiltinPluginRegistry);
  const localPlugins = useLocalPlugins(pluginRegistry);
  const [themeId, setThemeId] = useState('default');
  const pendingProject = useRef('');
  const mounted = useRef(true);
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++revision.current;
    try {
      const snapshot = await request<Snapshot>('snapshot');
      if (!mounted.current || current !== revision.current) return;
      setData(snapshot); setConnectionError(''); setLoaded(true);
    } catch (e) {
      if (mounted.current && current === revision.current) { setConnectionError(errorText(e)); setLoaded(true); }
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { await refresh(); if (mounted.current) timer = setTimeout(poll, 1000); };
    void poll();
    return () => { mounted.current = false; clearTimeout(timer); };
  }, [refresh]);
  const themes = [...BUILTIN_THEMES, ...localPlugins.themes];
  useEffect(() => {
    if (!localPlugins.loaded) return;
    initializeWorkbenchTheme();
    // Development-only browser acceptance fixture; production builds remove this branch.
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('theme-fixture') === 'incompatible') localStorage.setItem(THEME_STORAGE_KEY, 'incompatible-fixture');
    setThemeId(loadSavedTheme(themes));
  }, [localPlugins.loaded, localPlugins.themes]);
  useEffect(() => {
    if (pendingProject.current && data.projects.some(p => p.id === pendingProject.current)) {
      setProjectId(pendingProject.current);
      pendingProject.current = '';
    } else if (!data.projects.some(p => p.id === projectId)) setProjectId(data.projects[0]?.id ?? '');
    if (!data.providers.some(p => p.id === providerId)) setProviderId(data.providers[0]?.id ?? '');
  }, [data.projects, data.providers, projectId, providerId]);
  useEffect(() => {
    if (!data.conversations.some(c => c.id === conversationId && c.projectId === projectId)) {
      setConversationId(data.conversations.find(c => c.projectId === projectId)?.id ?? '');
    }
  }, [projectId, conversationId, data.conversations]);
  const mutate = async (method: string, params: Record<string, unknown>) => {
    setError('');
    try { await request(method, params); await refresh(); return true; }
    catch (e) { setError(errorText(e)); return false; }
  };
  const mutateCommand = async (command: UiCommand) => {
    setError('');
    try { await executeUiCommand(request, command); await refresh(); return true; }
    catch (e) { setError(errorText(e)); return false; }
  };
  const project = data.projects.find(p => p.id === projectId);
  const conversation = data.conversations.find(c => c.id === conversationId && c.projectId === projectId);
  const usage = data.usageContexts?.find(item => item.conversationId === conversationId);
  const workspace = createWorkspaceView(data, { projectId, conversationId });
  const history = useHistory(data, conversation?.id ?? '');
  const tasks = history.visible.tasks.filter(t => t.projectId === projectId && t.conversationId === conversation?.id);
  // Controls always use recent state, even while the user browses an older page.
  const active = history.recent.tasks.filter(t => t.projectId === projectId && t.conversationId === conversation?.id && isActive(t));
  const messages = history.visible.messages.filter(m => m.conversationId === conversation?.id);
  const draft = drafts[conversationId] ?? '';
  const disabled = !project || !conversation || !providerId || !!connectionError || busy || active.length > 0;
  const currentTask = [...history.recent.tasks].filter(task => task.projectId === projectId && task.conversationId === conversationId).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))[0];
  const activeTheme = themes.find(theme => theme.id === themeId);
  const selectTheme = (id: string) => {
    try {
      if (id === 'default') resetTheme();
      else applyTheme(themes.find(theme => theme.id === id), { persist: true });
      setThemeId(id);
    } catch { resetTheme(); setThemeId('default'); }
  };
  const submit = async () => {
    if (disabled || !draft.trim()) return;
    const id = conversationId;
    setBusy(true);
    try {
      if (await mutateCommand(uiCommands.submit(id, draft.trim(), providerId))) setDrafts(prev => ({ ...prev, [id]: '' }));
    } finally { setBusy(false); }
  };
  const addProject = async () => {
    if (adding) return;
    setAdding(true); setError('');
    try {
      const path = await executeUiCommand<string | null>(request, uiCommands.pickDirectory());
      if (path) {
        const project = await executeUiCommand<{ id: string }>(request, uiCommands.addProject(path));
        pendingProject.current = project.id;
        await refresh();
      }
    } catch (e) { setError(errorText(e)); }
    finally { setAdding(false); }
  };
  const createConversation = async () => {
    if (!project || busy) return;
    setBusy(true); setError('');
    try {
      const result = await executeUiCommand<{ id?: string }>(request, uiCommands.createConversation(projectId, '新会话'));
      await refresh();
      if (result?.id) setConversationId(result.id);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  return <PluginProvider registry={pluginRegistry}><ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: activeTheme?.tokens.accent ?? '#0f1115', borderRadius: Number.parseInt(activeTheme?.tokens.radius ?? '12', 10), colorBgLayout: activeTheme?.tokens.panel ?? '#fff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' } }}>
    <AppShell preferredRightWidth={activeTheme?.tokens.rightPanelWidth ? Number.parseInt(activeTheme.tokens.rightPanelWidth, 10) : undefined}
      rail={<ProjectRail projects={data.projects} selectedId={projectId} onSelect={setProjectId} onAdd={() => void addProject()} onSettings={() => openSettings('models')} adding={adding} />}
      sidebar={<WorkspaceSidebar>
        <div className="brand"><span className="brand-icon"><CodeOutlined /></span><strong>{project?.name ?? 'Moos'}<span>开发助手</span></strong><Tag>本地</Tag></div><SlotHost slot="sidebar.primary" />
        <div className="dsh-sidebar-actions"><Button className="dsh-new-chat" icon={<PlusOutlined />} aria-label="新建会话" disabled={!project || busy || !!connectionError} onClick={() => void createConversation()}>新会话</Button>
          <Button type="text" icon={<AppstoreOutlined />} onClick={() => openSettings('plugins')}>插件</Button>
          <Button type="text" icon={<BarChartOutlined />} onClick={() => openSettings('usage')}>用量统计</Button>
        </div>
        <div className="section-label">工作区<Button type="text" size="small" icon={<PlusOutlined />} aria-label="添加项目" disabled={adding} onClick={() => void addProject()} /></div>
        <nav className="projects" aria-label="项目列表">{workspace.projects.map(p => {
          const running = p.runningTasks;
          return <div key={p.id} className="dsh-project-group"><div className={`project-item ${p.selected ? 'selected' : ''}`}>
            <button className="project-button" aria-label={p.name} title={p.path} onClick={() => setProjectId(p.id)}><FolderOpenOutlined /><span>{p.name}</span>{running > 0 && <Badge count={running} color="#247e7b" title="后台任务执行中" />}</button>
            <Button type="text" size="small" icon={<DeleteOutlined />} aria-label={`移除项目 ${p.name}`} onClick={() => setRemoving(p.id)} />
          </div>{p.selected && <ConversationList items={workspace.conversations} projectId={projectId} disabled={!!connectionError || !loaded} onSelect={setConversationId} onRename={(id, title) => mutateCommand(uiCommands.renameConversation(projectId, id, title))} />}</div>;
        })}{loaded && !data.projects.length && <p className="sidebar-hint">添加本地目录，将任务与历史按项目隔离。</p>}</nav>
        <div className="sidebar-footer"><SlotHost slot="sidebar.footer" /><span>切换项目不会停止任务</span></div>
      </WorkspaceSidebar>}
      rightPanel={rightOpen ? <RightPanel projectName={project?.name} projectPath={project?.path} activeTasks={active.length} events={history.recent.events.filter(event => event.projectId === projectId && event.conversationId === conversationId && event.taskId === currentTask?.id)} taskStatus={currentTask?.status} onClose={() => setRightOpen(false)} /> : undefined}
      conversation={<ConversationPane>
        <header className="topbar"><div className="heading"><span className="eyebrow">开发工作台</span><h1>{conversation?.title ?? project?.name ?? '你的下一个想法，从这里开始'}</h1></div><SlotHost slot="conversation.header" context={{ projectId, conversationId }} />
          <Space><Button type="text" icon={<LayoutOutlined />} aria-label={rightOpen ? '关闭工具面板' : '打开工具面板'} aria-expanded={rightOpen} onClick={() => setRightOpen(value => !value)} /><Select aria-label="选择模型" className="model-select" placeholder="选择模型服务" value={providerId || undefined} onChange={setProviderId} options={data.providers.map(p => ({ value: p.id, label: `${p.name} · ${p.model}` }))} notFoundContent={<Button type="link" onClick={() => setSettings(true)}>配置模型服务</Button>} />
            <Tag color={connectionError ? 'error' : active.length ? 'processing' : 'default'}>{connectionError ? '连接中断' : !loaded ? '连接中' : active.length ? '执行中' : '待命'}</Tag>
            <Tooltip title="仅停止当前会话任务"><Button danger icon={<StopOutlined />} aria-label="停止任务" disabled={!active.length} onClick={() => { for (const t of active) void mutateCommand(uiCommands.cancelTask(t.id)); }}>停止</Button></Tooltip>
          </Space>
        </header>
        <div className="notice-area">{connectionError && <Alert type="error" showIcon message="无法连接本机服务" description={`${connectionError}。正在自动重连；请检查 Mac 服务是否运行。`} />}{error && <Alert type="error" showIcon closable message={error} onClose={() => setError('')} />}</div>
        <ConversationScroll viewKey={`${conversationId}:${history.isOlder ? String(history.page?.messages.before) : 'latest'}`} isOlder={history.isOlder}>
          <HistoryControls key={conversation?.id ?? ''} conversationId={conversation?.id ?? ''} page={history.page} isOlder={history.isOlder} loading={history.loading} error={history.error} onOlder={() => void history.loadOlder()} onLatest={history.latest} />
          {!loaded ? <Empty description="正在连接本机服务…" /> : !project ? <div className="welcome"><span className="welcome-icon"><CodeOutlined /></span><span className="eyebrow">MOOS · 本地开发工作空间</span><h2>添加项目，开始开发</h2><p>把想做的事交给助手。<br />在这里查看真实输出、工具动作与执行结果。</p><Button type="primary" icon={<FolderOpenOutlined />} disabled={adding} onClick={() => void addProject()}>选择项目目录</Button><div className="welcome-notes"><span>项目与会话独立管理</span><span>任务可随时停止</span><span>密钥留在 Mac</span></div></div> : !messages.length && !tasks.length ? <div className={conversation ? 'welcome is-chat-ready' : 'welcome'}><span className="welcome-icon"><MessageOutlined /></span><h2>{conversation && <img src={moosIcon} alt="" />}{conversation ? '今天想完成什么？' : '为这个项目新建一个会话'}</h2><p>{conversation ? '描述目标、问题或验收要求。提交后将直接执行任务。' : '会话用于保存任务和对话历史。切换会话不影响正在执行的任务。'}</p><code className="project-path">{project.path}</code>{!conversation && <Button onClick={() => void createConversation()} disabled={busy}>创建会话</Button>}</div> : <ConversationTranscript messages={messages} tasks={tasks} events={history.visible.events} onStop={id => void mutateCommand(uiCommands.cancelTask(id))} />}
          <TaskTrajectory events={history.visible.events.filter(e => e.conversationId === conversation?.id && e.projectId === projectId && !tasks.some(t => t.id === e.taskId))} />
        </ConversationScroll>
        <ComposerDock><SlotHost slot="composer.leading" context={{ projectId, conversationId }} />
          {!providerId && <div className="model-warning"><span>请先在设置中配置模型服务</span><Button size="small" type="link" onClick={() => setSettings(true)}>前往设置</Button></div>}
          <Sender aria-label="任务内容" value={draft} onChange={value => setDrafts(prev => ({ ...prev, [conversationId]: value }))} disabled={disabled} placeholder={!project ? '先添加一个项目目录' : !conversation ? '新建会话后描述任务' : !providerId ? '配置模型服务后即可提交' : '描述开发任务，Enter 发送，Shift + Enter 换行'} onSubmit={() => void submit()} actions={() => <Tooltip title="发送任务"><Button type="primary" icon={<ArrowUpOutlined />} aria-label="发送任务" disabled={disabled || !draft.trim()} loading={busy} onClick={() => void submit()} /></Tooltip>} />
          <PermissionMenu />
          <ComposerStatus projectName={project?.name} backgroundTasks={workspace.backgroundTaskCount} usage={usage} />
          <SlotHost slot="composer.trailing" context={{ projectId, conversationId }} />
          <div className="composer-footnote">任务在本机执行 · 输出以实际执行结果为准</div>
        </ComposerDock>
      </ConversationPane>}
    />
    <Modal title="仅移除项目记录？" open={!!removing} okText="移除记录" cancelText="取消" okButtonProps={{ danger: true }} onCancel={() => setRemoving(undefined)} onOk={async () => { if (removing && await mutateCommand(uiCommands.removeProject(removing))) setRemoving(undefined); }}><p>此操作仅移除项目元数据，不删除磁盘中的文件。正在运行的任务是否允许移除，由本机服务检查。</p></Modal>
    {settings && <Settings initialSection={settingsSection} providers={data.providers} projects={data.projects} conversations={data.conversations} runtime={data.runtime ?? emptySnapshot.runtime!} activeThemeId={themeId} onThemeApply={selectTheme} themes={themes} localPlugins={localPlugins} onClose={() => setSettings(false)} mutate={mutate} />}
  </ConfigProvider></PluginProvider>;
}
