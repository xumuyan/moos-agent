import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Bubble, Sender } from '@ant-design/x';
import { Alert, Badge, Button, ConfigProvider, Empty, Input, Modal, Select, Space, Tag, Tooltip } from 'antd';
import { CodeOutlined, DeleteOutlined, FolderOpenOutlined, MessageOutlined, PlusOutlined, SettingOutlined, StopOutlined } from '@ant-design/icons';
import zhCN from 'antd/locale/zh_CN';
import { request } from './api';
import { emptySnapshot, isActive, statusLabel, type Snapshot, type Task } from './types';
import Settings from './Settings';
import { useHistory } from './useHistory';
import HistoryControls from './HistoryControls';
import './style.css';

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
export default function App() {
  const [data, setData] = useState<Snapshot>(emptySnapshot);
  const [projectId, setProjectId] = useState('');
  const [conversationId, setConversationId] = useState('');
  const [providerId, setProviderId] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState(false);
  const [adding, setAdding] = useState(false);
  const [path, setPath] = useState('');
  const [removing, setRemoving] = useState<string>();
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
  useEffect(() => {
    if (!data.projects.some(p => p.id === projectId)) setProjectId(data.projects[0]?.id ?? '');
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
  const project = data.projects.find(p => p.id === projectId);
  const conversation = data.conversations.find(c => c.id === conversationId && c.projectId === projectId);
  const history = useHistory(data, conversation?.id ?? '');
  const tasks = history.visible.tasks.filter(t => t.projectId === projectId && t.conversationId === conversation?.id);
  // Controls always use recent state, even while the user browses an older page.
  const active = history.recent.tasks.filter(t => t.projectId === projectId && t.conversationId === conversation?.id && isActive(t));
  const messages = history.visible.messages.filter(m => m.conversationId === conversation?.id);
  // Anchor execution to the first associated message, not the task snapshot order.
  const taskAnchors = new Map(tasks.map(task => [task.id, messages.find(m => m.taskId === task.id)?.id]));
  const draft = drafts[conversationId] ?? '';
  const disabled = !project || !conversation || !providerId || !!connectionError || busy || active.length > 0;
  const submit = async () => {
    if (disabled || !draft.trim()) return;
    const id = conversationId;
    setBusy(true);
    try {
      if (await mutate('submit', { conversationId: id, message: draft.trim(), providerId })) setDrafts(prev => ({ ...prev, [id]: '' }));
    } finally { setBusy(false); }
  };
  const addProject = async () => {
    if (!path.trim()) return;
    setBusy(true);
    try { if (await mutate('add_project', { path: path.trim() })) { setPath(''); setAdding(false); } }
    finally { setBusy(false); }
  };
  const createConversation = async () => {
    if (!project || busy) return;
    setBusy(true); setError('');
    try {
      const result = await request<{ id?: string }>('create_conversation', { projectId, title: '新会话' });
      await refresh();
      if (result?.id) setConversationId(result.id);
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  const renderTask = (task: Task) => {
    const events = history.visible.events.filter(e => e.taskId === task.id && e.conversationId === conversationId && e.projectId === projectId);
    const saved = messages.some(m => m.taskId === task.id && m.role === 'assistant');
    const stream = events.filter(e => e.type === 'text_delta').map(e => typeof e.payload.delta === 'string' ? e.payload.delta : '').join('');
    const tools = events.filter(e => ['tool_start', 'tool_end', 'tool_update', 'task_state'].includes(e.type));
    return <section className="task-card" key={task.id} aria-label="任务执行记录">
      <div className="task-heading"><CodeOutlined /><span>任务记录</span><Tag color={isActive(task) ? 'processing' : task.status === 'failed' ? 'error' : 'default'}>{statusLabel(task.status)}</Tag><span className="task-id">{task.id}</span>
        {isActive(task) && <Button size="small" danger aria-label="停止此任务" onClick={() => void mutate('cancel', { taskId: task.id })}>停止</Button>}
      </div>
      {!messages.some(m => m.taskId === task.id && m.role === 'user') && <div className="task-prompt">{task.message}</div>}
      {stream && !saved && <Bubble content={<span className="plain-text">{stream}</span>} />}
      {tools.map(e => <details className="tool-row" key={e.id}><summary><CodeOutlined /> {String(e.payload.name ?? e.payload.toolName ?? e.type)} <span className="muted">{e.type}</span></summary><pre>{JSON.stringify(e.payload, null, 2)}</pre></details>)}
      {task.error && <Alert type="error" message={task.error} showIcon />}
      {isActive(task) && !stream && tools.length === 0 && <p className="muted">等待执行事件；尚未收到模型输出。</p>}
    </section>;
  };
  return <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#247e7b', borderRadius: 9, colorBgLayout: '#f5f7f9', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' } }}>
    <div className="desktop-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-icon"><CodeOutlined /></span><strong>Moos<span>开发助手</span></strong><Tag>本地</Tag></div>
        <div className="section-label">工作空间<Button type="text" size="small" icon={<PlusOutlined />} aria-label="添加项目" onClick={() => setAdding(true)} /></div>
        <nav className="projects" aria-label="项目列表">{data.projects.map(p => {
          const running = data.tasks.filter(t => t.projectId === p.id && isActive(t)).length;
          return <div key={p.id} className={`project-item ${p.id === projectId ? 'selected' : ''}`}>
            <button className="project-button" aria-label={p.name} title={p.path} onClick={() => setProjectId(p.id)}><FolderOpenOutlined /><span>{p.name}</span>{running > 0 && <Badge count={running} color="#247e7b" title="后台任务执行中" />}</button>
            <Button type="text" size="small" icon={<DeleteOutlined />} aria-label={`移除项目 ${p.name}`} onClick={() => setRemoving(p.id)} />
          </div>;
        })}{loaded && !data.projects.length && <p className="sidebar-hint">添加本地目录，将任务与历史按项目隔离。</p>}</nav>
        <div className="section-label">会话历史<Button type="text" size="small" icon={<PlusOutlined />} aria-label="新建会话" disabled={!project || busy || !!connectionError} onClick={() => void createConversation()} /></div>
        <nav className="conversations" aria-label="会话历史">{data.conversations.filter(c => c.projectId === projectId).map(c => <button key={c.id} aria-label={c.title} className={`conversation-button ${c.id === conversation?.id ? 'selected' : ''}`} onClick={() => setConversationId(c.id)}><MessageOutlined /><span>{c.title}</span>{data.tasks.some(t => t.conversationId === c.id && isActive(t)) && <Badge status="processing" />}</button>)}{project && !data.conversations.some(c => c.projectId === projectId) && <p className="sidebar-hint">暂无会话，点击 + 新建。</p>}</nav>
        <div className="sidebar-footer"><span>切换项目不会停止任务</span><Button icon={<SettingOutlined />} onClick={() => setSettings(true)}>设置</Button></div>
      </aside>
      <main className="main-panel">
        <header className="topbar"><div className="heading"><span className="eyebrow">开发工作台</span><h1>{conversation?.title ?? project?.name ?? '你的下一个想法，从这里开始'}</h1></div>
          <Space><Select aria-label="选择模型" className="model-select" placeholder="选择模型服务" value={providerId || undefined} onChange={setProviderId} options={data.providers.map(p => ({ value: p.id, label: `${p.name} · ${p.model}` }))} notFoundContent={<Button type="link" onClick={() => setSettings(true)}>配置模型服务</Button>} />
            <Tag color={connectionError ? 'error' : active.length ? 'processing' : 'default'}>{connectionError ? '连接中断' : !loaded ? '连接中' : active.length ? '执行中' : '待命'}</Tag>
            <Tooltip title="仅停止当前会话任务"><Button danger icon={<StopOutlined />} aria-label="停止任务" disabled={!active.length} onClick={() => { for (const t of active) void mutate('cancel', { taskId: t.id }); }}>停止</Button></Tooltip>
          </Space>
        </header>
        <div className="notice-area">{connectionError && <Alert type="error" showIcon message="无法连接本机服务" description={`${connectionError}。正在自动重连；请检查 Mac 服务是否运行。`} />}{error && <Alert type="error" showIcon closable message={error} onClose={() => setError('')} />}</div>
        <div className="conversation-area" aria-label="对话内容" aria-live={history.isOlder ? 'off' : 'polite'}>
          <HistoryControls key={conversation?.id ?? ''} conversationId={conversation?.id ?? ''} page={history.page} isOlder={history.isOlder} loading={history.loading} error={history.error} onOlder={() => void history.loadOlder()} onLatest={history.latest} />
          {!loaded ? <Empty description="正在连接本机服务…" /> : !project ? <div className="welcome"><span className="welcome-icon"><CodeOutlined /></span><span className="eyebrow">MOOS · 本地开发工作空间</span><h2>添加项目，开始开发</h2><p>把想做的事交给助手。<br />在这里查看真实输出、工具动作与执行结果。</p><Button type="primary" icon={<FolderOpenOutlined />} onClick={() => setAdding(true)}>选择项目目录</Button><div className="welcome-notes"><span>项目与会话独立管理</span><span>任务可随时停止</span><span>密钥留在 Mac</span></div></div> : !messages.length && !tasks.length ? <div className="welcome"><span className="welcome-icon"><MessageOutlined /></span><h2>{conversation ? '今天想完成什么？' : '为这个项目新建一个会话'}</h2><p>{conversation ? '描述目标、问题或验收要求。提交后将直接执行任务。' : '会话用于保存任务和对话历史。切换会话不影响正在执行的任务。'}</p><code className="project-path">{project.path}</code>{!conversation && <Button onClick={() => void createConversation()} disabled={busy}>创建会话</Button>}</div> : <div className="thread">{messages.map(m => {
            const associated = tasks.filter(task => taskAnchors.get(task.id) === m.id);
            return <Fragment key={m.id}>
              {m.role !== 'user' && associated.map(renderTask)}
              <div className={`message message-${m.role}`}><div className="message-label">{m.role === 'user' ? '你' : m.role === 'assistant' ? 'Moos' : m.role}</div><Bubble placement={m.role === 'user' ? 'end' : 'start'} content={<span className="plain-text">{m.content}</span>} /></div>
              {m.role === 'user' && associated.map(renderTask)}
            </Fragment>;
          })}{tasks.filter(task => !taskAnchors.get(task.id)).map(renderTask)}</div>}
          {history.visible.events.filter(e => e.conversationId === conversation?.id && e.projectId === projectId && !tasks.some(t => t.id === e.taskId)).map(e => <details className="tool-row" key={e.id}><summary><CodeOutlined /> {String(e.payload.name ?? e.payload.toolName ?? e.type)} <span className="muted">{e.type} · 任务 {e.taskId}（位于其他分页）</span></summary><pre>{JSON.stringify(e.payload, null, 2)}</pre></details>)}
        </div>
        <footer className="composer"><div className="composer-context"><span><FolderOpenOutlined /> {project?.name ?? '未选择项目'}</span><span>{data.tasks.filter(t => isActive(t) && t.conversationId !== conversation?.id).length} 个后台任务</span></div>
          {!providerId && <div className="model-warning"><span>请先在设置中配置模型服务</span><Button size="small" type="link" onClick={() => setSettings(true)}>前往设置</Button></div>}
          <Sender aria-label="任务内容" value={draft} onChange={value => setDrafts(prev => ({ ...prev, [conversationId]: value }))} disabled={disabled} placeholder={!project ? '先添加一个项目目录' : !conversation ? '新建会话后描述任务' : !providerId ? '配置模型服务后即可提交' : '描述开发任务，Enter 发送，Shift + Enter 换行'} onSubmit={() => void submit()} actions={() => <Button type="primary" aria-label="发送任务" disabled={disabled || !draft.trim()} loading={busy} onClick={() => void submit()}>发送任务</Button>} />
          <div className="composer-footnote">任务在本机执行 · 输出以实际执行结果为准</div>
        </footer>
      </main>
    </div>
    <Modal title="添加本地项目" open={adding} onCancel={() => setAdding(false)} footer={<Button type="primary" loading={busy} disabled={!path.trim()} onClick={() => void addProject()}>添加目录</Button>}>
      <p className="muted">填写 Mac 上的项目绝对路径。项目文件不会被移动。</p><Input aria-label="项目目录" placeholder="/Users/你的用户名/Projects/项目" value={path} onChange={e => setPath(e.target.value)} onPressEnter={() => { if (!busy) void addProject(); }} />
    </Modal>
    <Modal title="仅移除项目记录？" open={!!removing} okText="移除记录" cancelText="取消" okButtonProps={{ danger: true }} onCancel={() => setRemoving(undefined)} onOk={async () => { if (await mutate('remove_project', { projectId: removing })) setRemoving(undefined); }}><p>此操作仅移除项目元数据，不删除磁盘中的文件。正在运行的任务是否允许移除，由本机服务检查。</p></Modal>
    {settings && <Settings providers={data.providers} onClose={() => setSettings(false)} mutate={mutate} />}
  </ConfigProvider>;
}
