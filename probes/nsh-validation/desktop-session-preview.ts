import type { Session, TaskStatus } from './desktop-contract';

type Preview = NonNullable<Session['preview']>;
type Activity = { busy: boolean; stopping: boolean; error: string; task: { status: TaskStatus } | null };
const labels: Record<TaskStatus, string> = {
  queued: '排队中', running: '进行中', succeeded: '已完成', failed: '失败', cancelled: '已停止', interrupted: '已中断',
};

// The owner controller intentionally only retains id/projectId/title. Read the
// optional presentation fields alongside it, without changing that owner seam.
export function sessionPreviews() {
  const projects = new Map<string, Map<string, Preview>>();
  return {
    read(projectId: string, sessionId: string) { return projects.get(projectId)?.get(sessionId); },
    remember(projectId: string, items: unknown) {
      if (!Array.isArray(items) || items.length > 16) return;
      let rows = projects.get(projectId);
      if (!rows) {
        if (projects.size >= 8) return;
        projects.set(projectId, rows = new Map());
      }
      for (const row of items) {
        if (row?.projectId !== projectId || typeof row.id !== 'string' || !row.id || row.id.length > 64) continue;
        const p = row.preview;
        rows.delete(row.id);
        if (!p || typeof p.workspaceLabel !== 'string' || p.workspaceLabel.length > 200 ||
          !/^[\p{L}\p{N}_-][\p{L}\p{N} ._/-]*$/u.test(p.workspaceLabel) ||
          p.workspaceLabel.split('/').some((part: string) => !part || part === '.' || part === '..') ||
          typeof p.createdAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(p.createdAt)) continue;
        const time = Date.parse(p.createdAt);
        if (!Number.isFinite(time) || new Date(time).toISOString() !== p.createdAt) continue;
        if (rows.size < 16) rows.set(row.id, { workspaceLabel: p.workspaceLabel, createdAt: p.createdAt });
      }
    },
  };
}

export function sessionAge(createdAt: string, now: number) {
  const seconds = Math.max(0, (now - Date.parse(createdAt)) / 1000);
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}

export function sessionPreviewStatus(activity?: Activity, submitting = false) {
  if (!activity) return '';
  if (activity.error) return '状态未确认';
  if (submitting) return '提交中';
  if (activity.stopping && activity.busy) return '正在停止';
  if (activity.task?.status === 'queued' && activity.busy) return labels.queued;
  if (activity.busy) return !activity.task ? '提交中' : activity.task.status === 'running' ? labels.running : '等待收尾';
  return activity.task ? labels[activity.task.status] : '';
}
