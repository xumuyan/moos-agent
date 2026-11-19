// Explicit synthetic bridge responses for view verification. No real PI task claim.
export function fixture(options: { long?: boolean; error?: boolean; empty?: boolean; longNames?: boolean; dense?: boolean; chatCards?: boolean } = {}) {
  let stopped = false;
  const ok = (result: unknown) => ({ version: 1, id: 'theme-fixture', ok: true, result });
  const task = (p: any, status: string) => ({ id: p.taskId ?? 'theme-task', projectId: p.projectId, sessionId: p.sessionId, status, errorCode: null });
  return {
    'projects.list': () => ok({ projects: options.empty ? [] : options.dense ? Array.from('abcdefgh', (id, i) => ({ id, name: `主题验证 ${String.fromCharCode(65 + i)}` })) : [{ id: 'a', name: options.longNames ? '主题验证 A 很长的项目名称用于检查丝带文字安全域与截断' : '主题验证 A' }, { id: 'b', name: '主题验证 B' }] }),
    'sessions.list': (p: any) => ok({ sessions: options.dense ? Array.from({ length: 16 }, (_, i) => ({ id: `${p.projectId}-${i}`, projectId: p.projectId, title: `合成会话 ${i + 1}` })) : [{ id: `s-${p.projectId}`, projectId: p.projectId, title: '独立会话' }, { id: `other-${p.projectId}`, projectId: p.projectId, title: '第二会话' }] }),
    'sessions.create': (p: any) => ok({ session: { id: 'created', projectId: p.projectId, title: p.title } }),
    'tasks.submit': (p: any) => { if (options.error) throw Error('private-secret'); return ok({ task: task(p, 'queued'), replayed: false }); },
    'tasks.events': (p: any) => {
      const start = p.cursor ? Number(p.cursor.split(':')[1]) : 0;
      const total = options.long ? 1000 : options.chatCards ? 5 : 3;
      const end = Math.min(start + 100, total);
      const events = Array.from({ length: end - start }, (_, i) => {
        const sequence = start + i + 1;
        if (sequence === 4 && options.chatCards) return { sequence, type: 'tool_start', payload: { toolCallId: 'tool-4', toolName: 'write' } };
        if (sequence === 5 && options.chatCards) return { sequence, type: 'tool_end', payload: { toolCallId: 'tool-4', toolName: 'write', isError: false } };
        return options.long || sequence === 2 ? { sequence, type: 'tool_start', payload: { toolCallId: `tool-${sequence}`, toolName: 'read' } } :
          sequence === 3 ? { sequence, type: 'tool_end', payload: { toolCallId: 'tool-2', toolName: 'read', isError: true } } :
          { sequence, type: 'text_delta', payload: { delta: '主题测试夹具：公开流式文本（不是实际任务）', truncated: false } };
      });
      return ok({ task: task(p, stopped ? 'cancelled' : 'running'), terminal: stopped, events, cursor: `${p.taskId}:${end}`, hasMore: end < total });
    },
    'tasks.cancel': (p: any) => { stopped = true; return ok({ task: task(p, 'running') }); },
  };
}
