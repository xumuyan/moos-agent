import type { Calls, SavedService, Session } from './desktop-contract';

const models = { defaultId: 'vision', options: [{ id: 'vision', label: '测试视觉模型', imageInput: true as const }] };
const session = { id: 'one', projectId: 'demo', title: '设计会话',
  preview: { workspaceLabel: 'test-workspace', workspacePath: '/private/tmp/test-workspace', createdAt: '2026-11-21T02:00:00.000Z' } };
export function managementFixture(switching = false) {
  let sessions: Session[] = switching ? [session,
    { ...session, id: 'slow', title: '慢会话' }, { ...session, id: 'fast', title: '快会话' }] : [session];
  let archived: Session[] = [];
  const imported = { id: 'dsh-old', origin: 'DSH', title: '导入的会话', workspace: '旧工作区',
    updated: '2026-10-01T12:00:00Z', archived: 0, linked: null, messages: 2 };
  const image = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGNIn3qAJMQwqmFUw/DVAACx2bwQBikQCwAAAABJRU5ErkJggg==';
  let services: SavedService[] = [];
  const ok = (result: unknown) => ({ version: 1, id: 'test', ok: true, result });
  const task = { id: 'task', projectId: 'demo', sessionId: 'one', status: 'succeeded', errorCode: null };
  let goalSubmission = false;
  return { handlers: {
    'projects.list': () => ok({ projects: [{ id: 'demo', name: '候选验收' }, { id: 'other', name: '隔离验收' }], models, desktopManagement: true, teamGoals: true }),
    'sessions.list': (p: Calls['sessions.list']['params']) => ok(p.projectId === 'demo' ? { sessions, imported: [imported] } : { sessions: [] }),
    'sessions.history': async (p: Calls['sessions.history']['params']) => {
      if (switching && p.sessionId === 'slow') await new Promise(resolve => setTimeout(resolve, 900));
      const text = ({ one: '首个会话的内容', slow: '慢会话的内容', fast: '快会话的内容' } as Record<string, string>)[p.sessionId];
      return ok({ projectId: p.projectId, sessionId: p.sessionId,
        messages: switching && text ? [{ id: p.sessionId + '-message', text, role: 'assistant', truncated: false }] : [], before: null });
    },
    'sessions.manage': (p: Calls['sessions.manage']['params']) => {
      if (p.action === 'importedPage' && p.projectId === 'demo') return ok({ sessions: [], importedPage: {
        session: imported, before: p.before ? null : 2,
        items: p.before ? [{ id: 1, role: 'user', date: imported.updated, body: '原始提问', continuation: 0, assets: [] }]
          : [{ id: 2, role: 'assistant', date: imported.updated, body: '原始回复', continuation: 0,
            assets: [{ id: 1, name: '附件截图.png', mime: 'image/png', bytes: atob(image).length }] }],
      } });
      if (p.action === 'importedAsset' && p.projectId === 'demo') return ok({ sessions: [], asset: { data: image, end: true } });
      if (p.action === 'listArchived') return ok({ sessions: archived });
      if (p.action === 'archive') {
        archived = sessions.filter(item => item.id === p.sessionId);
        sessions = sessions.filter(item => item.id !== p.sessionId);
      }
      if (p.action === 'restore') {
        sessions = [...sessions, ...archived.filter(item => item.id === p.sessionId)];
        archived = archived.filter(item => item.id !== p.sessionId);
        return ok({ sessions, selectedId: p.sessionId });
      }
      if (p.action === 'rename') sessions = [{ ...sessions[0], title: p.title }];
      if (p.action === 'pin') sessions = [{ ...sessions[0], pinned: true }];
      return ok({ sessions });
    },
    'models.manage': (p: Calls['models.manage']['params']) => {
      if (p.action === 'save') {
        const { apiKey, ...metadata } = p.service;
        services = [{ ...metadata, id: 'new-relay', hasKey: !!apiKey, models: [{ ...p.model, id: 'new-model' }] }];
      }
      return ok({ services, models });
    },
    'images.stage': () => ok({}),
    'tasks.submit': (p: Calls['tasks.submit']['params']) => {
      goalSubmission = p.teamGoal === 'start';
      const first = p.draft ? { id: p.sessionId, projectId: p.projectId, title: `新会话 ${sessions.length + 1}` } : undefined;
      if (first) sessions = [...sessions, first];
      return ok({ task: { ...task, projectId: p.projectId, sessionId: p.sessionId, status: 'running' }, replayed: false, ...(first && { session: first }) });
    },
    'tasks.events': async (p: Calls['tasks.events']['params']) => {
      if (goalSubmission) await new Promise(resolve => setTimeout(resolve, 1500));
      const failed = p.sessionId === 'fast';
      const result = { status: failed ? 'failed' : 'succeeded', errorCode: failed ? 'fixture_failure' : null };
      return ok({
      task: { ...task, projectId: p.projectId, sessionId: p.sessionId, ...result }, terminal: true, hasMore: false, cursor: 'task:7',
      events: [
        { sequence: 1, type: 'text_delta', payload: { delta: '先读取再修改', truncated: false } },
        { sequence: 2, type: 'tool_start', payload: { toolCallId: 'edit', toolName: 'edit' } },
        { sequence: 3, type: 'tool_end', payload: { toolCallId: 'edit', toolName: 'edit', isError: false } },
        { sequence: 4, type: 'tool_start', payload: { toolCallId: 'status', toolName: 'bash', commandPreview: 'git status --short' } },
        { sequence: 5, type: 'tool_end', payload: { toolCallId: 'status', toolName: 'bash', isError: false } },
        { sequence: 6, type: 'text_delta', payload: { delta: '已完成合成验收', truncated: false } },
        { sequence: 7, type: 'task_state', payload: result },
      ], workspaceChanges: { files: [
        { path: 'test-file.txt', summary: '修改' }, { path: 'added.txt', summary: '新增' },
        { path: 'removed.txt', summary: '删除' }, { path: 'last.txt', summary: '修改' },
      ], limited: false } });
    },
  } };
}
