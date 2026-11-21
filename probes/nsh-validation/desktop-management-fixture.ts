import type { Calls, SavedService, Session } from './desktop-contract';

const models = { defaultId: 'vision', options: [{ id: 'vision', label: '测试视觉模型', imageInput: true as const }] };
const session = { id: 'one', projectId: 'demo', title: '设计会话',
  preview: { workspaceLabel: 'test-workspace', workspacePath: '/private/tmp/test-workspace', createdAt: '2026-11-21T02:00:00.000Z' } };
export function managementFixture() {
  let sessions: Session[] = [session];
  let archived: Session[] = [];
  const imported = { id: 'dsh-old', origin: 'DSH', title: '导入的会话', workspace: '旧工作区',
    updated: '2026-10-01T12:00:00Z', archived: 0, linked: null, messages: 2 };
  const image = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGNIn3qAJMQwqmFUw/DVAACx2bwQBikQCwAAAABJRU5ErkJggg==';
  let services: SavedService[] = [];
  const ok = (result: unknown) => ({ version: 1, id: 'test', ok: true, result });
  const task = { id: 'task', projectId: 'demo', sessionId: 'one', status: 'succeeded', errorCode: null };
  return { handlers: {
    'projects.list': () => ok({ projects: [{ id: 'demo', name: '候选验收' }, { id: 'other', name: '隔离验收' }], models, desktopManagement: true, teamGoals: true }),
    'sessions.list': (p: Calls['sessions.list']['params']) => ok(p.projectId === 'demo' ? { sessions, imported: [imported] } : { sessions: [] }),
    'sessions.history': (p: Calls['sessions.history']['params']) => ok({ projectId: p.projectId, sessionId: p.sessionId, messages: [], before: null }),
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
    'tasks.submit': () => ok({ task, replayed: false }),
    'tasks.events': () => ok({ task, terminal: true, hasMore: false, cursor: 'task:4',
      events: [
        { sequence: 1, type: 'tool_start', payload: { toolCallId: 'edit', toolName: 'edit' } },
        { sequence: 2, type: 'tool_end', payload: { toolCallId: 'edit', toolName: 'edit', isError: false } },
        { sequence: 3, type: 'text_delta', payload: { delta: '已完成合成验收', truncated: false } },
        { sequence: 4, type: 'task_state', payload: { status: 'succeeded', errorCode: null } },
      ], workspaceChanges: { files: [{ path: 'test-file.txt', summary: '修改' }], limited: false } }),
  } };
}
