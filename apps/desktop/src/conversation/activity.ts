import type { AgentEvent } from '../types';

export function activities(events: AgentEvent[]) {
  const rows = new Map<string, { id: string; name: string; path: string; done: boolean; failed: boolean }>();
  for (const event of events) {
    if (!['tool_start', 'tool_end'].includes(event.type)) continue;
    const key = String(event.payload.toolCallId ?? event.id);
    const previous = rows.get(key);
    const args = event.payload.args as Record<string, unknown> | undefined;
    rows.set(key, { id: key, name: String(event.payload.toolName ?? event.payload.name ?? previous?.name ?? '工具'),
      path: typeof args?.path === 'string' ? args.path : previous?.path ?? '',
      done: event.type === 'tool_end', failed: event.payload.isError === true });
  }
  return [...rows.values()];
}

export function activityLabel(name: string) {
  return ({ read: '读取文件', write: '写入文件', edit: '修改文件', bash: '运行命令', grep: '搜索内容', find: '查找文件', ls: '查看目录' }[name] ?? name);
}

export function activityGroups(events: AgentEvent[]) {
  const groups: { id: string; label: string; rows: ReturnType<typeof activities> }[] = [];
  for (const row of activities(events)) {
    const label = ['read', 'ls', 'find'].includes(row.name) ? '读取与浏览'
      : row.name === 'grep' ? '搜索内容' : ['write', 'edit'].includes(row.name) ? '编辑文件'
        : row.name === 'bash' ? '运行命令' : '其他工具';
    const previous = groups.at(-1);
    if (previous?.label === label) previous.rows.push(row);
    else groups.push({ id: row.id, label, rows: [row] });
  }
  return groups;
}

export function changedFiles(events: AgentEvent[]) {
  const files = new Map<string, Set<string>>();
  for (const row of activities(events)) {
    if (!row.done || row.failed || !row.path || !['write', 'edit'].includes(row.name)) continue;
    const actions = files.get(row.path) ?? new Set<string>();
    actions.add(row.name === 'write' ? '写入文件' : '局部修改'); files.set(row.path, actions);
  }
  return [...files].map(([path, actions]) => ({ path, description: [...actions].join('、') }));
}

export function withoutCodeBlocks(text: string) {
  return text.replace(/```[^\n]*\n[\s\S]*?(?:```|$)/g, '（代码内容已省略）').replace(/~~~[^\n]*\n[\s\S]*?(?:~~~|$)/g, '（代码内容已省略）');
}
