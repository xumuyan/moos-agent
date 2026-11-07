import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, ConfigProvider, Empty, Modal } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { request } from './api';
import { emptySnapshot, isActive, type Snapshot } from './types';
import Settings from './Settings';
import moosIcon from './moos-icon.png';
import { useHistory } from './useHistory';
import HistoryControls from './HistoryControls';
import AppShell from './layout/AppShell';
import ConversationList from './layout/ConversationList';
import RightPanel from './layout/RightPanel';
import ConversationTranscript from './conversation/ConversationTranscript';
import ConversationScroll from './conversation/ConversationScroll';
import ComposerStatus from './composer/ComposerStatus';
import { createBuiltinPluginRegistry } from './builtin-plugins/insights';
import { PluginProvider, SlotHost } from './plugins/slots';
import { BUILTIN_THEMES } from './themes/builtin';
import type { ThemeDefinition } from './themes/schema';
import { applyTheme, loadSavedTheme, resetTheme, initializeWorkbenchTheme, THEME_STORAGE_KEY } from './themes/loader';
import { useLocalPlugins } from './plugins/useLocalPlugins';
import TaskTrajectory from './conversation/TaskTrajectory';
import { createWorkspaceView } from './ui-adapter/snapshot';
import { executeUiCommand, uiCommands, type UiCommand } from './ui-adapter/commands';
import './theme/tokens.css';
import './vendor/dsh/theme/index.css';
import './vendor/dsh/host.css';
import './themes/wallpaper.css';
import { loadWallpaper } from './themes/wallpaper';
import DshComposer from './vendor/dsh/composer/DshComposer';
import rootCss from './vendor/dsh/composer/ConversationRoot.module.css';
import DshNavigation from './vendor/dsh/sidebar/DshNavigation';
import { DshModelPicker, DshPermissionMenu } from './vendor/dsh/menus';
import IconSprite from './vendor/dsh/primitives/IconSprite';
import { IconAppsAddOutlineRegular, IconPanelLeftOutlineRegular, IconDataOutlineMedium } from './vendor/dsh/primitives/icons/index';

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
  useEffect(() => { void loadWallpaper().catch(() => { /* Settings exposes the persisted load error and recovery. */ }); }, []);
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
  const selectTheme = (target: string | ThemeDefinition) => {
    try {
      if (target === 'default') {
        resetTheme();
        setThemeId('default');
      } else {
        const theme = typeof target === 'string' ? themes.find(item => item.id === target) : target;
        setThemeId(applyTheme(theme, { persist: true }).id);
      }
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
  const hasHistory = messages.length > 0 || tasks.length > 0 || history.visible.events.some(event=>event.projectId===projectId&&event.conversationId===conversationId) || (['messages','tasks','events'] as const).some(key => (history.page?.[key].total ?? 0) > 0);
  const hero = loaded && !!project && !!conversation && !hasHistory && !history.error && !history.isOlder;
  const composer = <DshComposer value={draft} onChange={value=>setDrafts(prev=>({...prev,[conversationId]:value}))}
    onSubmit={()=>void submit()} disabled={disabled} busy={busy} running={active.length>0}
    onStop={()=>{for(const task of active)void mutateCommand(uiCommands.cancelTask(task.id));}}
    hero={hero} workspaceName={project?.name} icon={<img src={moosIcon} alt="" width={32} height={32}/>}
    placeholder={!project?'先添加一个项目目录':!conversation?'新建会话后描述任务':!providerId?'配置模型服务后即可提交':'描述开发任务，Enter 发送，Shift + Enter 换行'}
    leading={<SlotHost slot="composer.leading" context={{projectId,conversationId,panelTargetId:'moos-composer-addon-panel'}}/>}
    permission={<DshPermissionMenu/>}
    model={<DshModelPicker items={data.providers.map(provider=>({id:provider.id,name:provider.name,model:provider.model}))} value={providerId} onChange={setProviderId} disabled={busy||!!connectionError}/>}
    readings={<ComposerStatus projectName={project?.name} backgroundTasks={workspace.backgroundTaskCount} usage={usage}/>}
    trailing={<SlotHost slot="composer.trailing" context={{projectId,conversationId}}/>}/>;
  return <PluginProvider registry={pluginRegistry}><ConfigProvider locale={zhCN} theme={{token:{colorPrimary:activeTheme?.tokens.accent??'#0f1115',borderRadius:Number.parseInt(activeTheme?.tokens.radius??'12',10),colorBgLayout:activeTheme?.tokens.panel??'#fff',fontFamily:'-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'}}}>
    <IconSprite/>
    <AppShell sidebar={null} onNewConversation={()=>void createConversation()} newConversationDisabled={!project||busy||!!connectionError} preferredRightWidth={activeTheme?.tokens.rightPanelWidth?Number.parseInt(activeTheme.tokens.rightPanelWidth,10):undefined}
      navigation={state=><DshNavigation {...state} projects={workspace.projects}
        conversations={<ConversationList items={workspace.conversations} projectId={projectId} disabled={!!connectionError||!loaded} onSelect={setConversationId} onRename={(id,title)=>mutateCommand(uiCommands.renameConversation(projectId,id,title))}/>}
        onProject={setProjectId} onRemove={setRemoving} onAdd={()=>void addProject()} onNew={()=>void createConversation()}
        newDisabled={!project||busy||!!connectionError} onSettings={()=>openSettings('models')}
        panels={[{id:'plugins',label:'插件',icon:<IconAppsAddOutlineRegular/>,onClick:()=>openSettings('plugins')},{id:'usage',label:'用量统计',icon:<IconDataOutlineMedium/>,onClick:()=>openSettings('usage')}]}
        primary={<SlotHost slot="sidebar.primary"/>} footer={<><SlotHost slot="sidebar.footer"/><span className="moos-sidebar-note">切换项目不会停止任务</span></>}/>}
      rightPanel={rightOpen?<RightPanel projectName={project?.name} projectPath={project?.path} activeTasks={active.length} events={history.recent.events.filter(event=>event.projectId===projectId&&event.conversationId===conversationId&&event.taskId===currentTask?.id)} taskStatus={currentTask?.status} onClose={()=>setRightOpen(false)}/>:undefined}
      conversation={<main className={`${rootCss.root} conversation-pane`} data-phase={hero?'hero':'active'} aria-label="对话工作区">
        <header className={`${rootCss.header} ${hero?rootCss.headerBlank:''}`} data-tauri-drag-region>
          <div className={rootCss.titleRow}><div className={rootCss.titleCluster}><h1 className={hero?'moos-sr-only':'moos-session-title'}>{conversation?.title??project?.name??'Moos'}</h1><SlotHost slot="conversation.header" context={{projectId,conversationId}}/></div>
            <div className={rootCss.headerCorner}><button className={rootCss.headerMenuButton} aria-label={rightOpen?'关闭工具面板':'打开工具面板'} aria-expanded={rightOpen} onClick={()=>setRightOpen(value=>!value)}><IconPanelLeftOutlineRegular/></button></div>
          </div>
        </header>
        <div className={rootCss.body}>
          <div className="moos-notices">{connectionError&&<Alert type="error" showIcon message="无法连接本机服务" description={`${connectionError}。正在自动重连；请检查 Mac 服务是否运行。`}/>}{error&&<Alert type="error" showIcon closable message={error} onClose={()=>setError('')}/>}</div>
          <ConversationScroll viewKey={`${conversationId}:${history.isOlder?String(history.page?.messages.before):'latest'}`} isOlder={history.isOlder} hero={hero} composer={<>{!providerId&&<div className="moos-model-warning">请先在设置中配置模型服务 <button onClick={()=>setSettings(true)}>前往设置</button></div>}{composer}</>}>
              <HistoryControls key={conversation?.id??''} conversationId={conversation?.id??''} page={history.page} isOlder={history.isOlder} loading={history.loading} error={history.error} onOlder={()=>void history.loadOlder()} onLatest={history.latest}/>
              {!loaded?<Empty description="正在连接本机服务…"/>:!project?<div className="moos-empty"><h2>添加项目，开始开发</h2><Button onClick={()=>void addProject()} disabled={adding}>选择项目目录</Button></div>:!conversation?<div className="moos-empty"><h2>为这个项目新建一个会话</h2><Button onClick={()=>void createConversation()} disabled={busy}>创建会话</Button></div>:<ConversationTranscript messages={messages} tasks={tasks} events={history.visible.events} onStop={id=>void mutateCommand(uiCommands.cancelTask(id))}/>}
              <TaskTrajectory events={history.visible.events.filter(event=>event.conversationId===conversation?.id&&event.projectId===projectId&&!tasks.some(task=>task.id===event.taskId))}/>
            </ConversationScroll>

        </div>
      </main>}/>
    <Modal title="仅移除项目记录？" open={!!removing} okText="移除记录" cancelText="取消" okButtonProps={{ danger: true }} onCancel={() => setRemoving(undefined)} onOk={async () => { if (removing && await mutateCommand(uiCommands.removeProject(removing))) setRemoving(undefined); }}><p>此操作仅移除项目元数据，不删除磁盘中的文件。正在运行的任务是否允许移除，由本机服务检查。</p></Modal>
    {settings && <Settings initialSection={settingsSection} providers={data.providers} projects={data.projects} conversations={data.conversations} runtime={data.runtime ?? emptySnapshot.runtime!} activeThemeId={themeId} onThemeApply={selectTheme} localPlugins={localPlugins} onClose={() => setSettings(false)} mutate={mutate} />}
  </ConfigProvider></PluginProvider>;
}
