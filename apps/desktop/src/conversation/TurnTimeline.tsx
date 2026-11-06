import type { ReactNode } from 'react';
import { Button } from 'antd';
import { CodeOutlined, EditOutlined, FileTextOutlined, SearchOutlined, ToolOutlined } from '@ant-design/icons';
import { isActive, statusLabel, type AgentEvent, type Task } from '../types';
import { activities, activityLabel, changedFiles } from './activity';
import { TaskFiles } from './TaskTrajectory';
import MessageContent from './MessageContent';
import { projectTimeline } from './timeline';

function toolTitle(events: AgentEvent[]) {
  const names = new Set(activities(events).map(row => row.name));
  const edits = names.has('write') || names.has('edit');
  if (edits && names.has('bash')) return '编辑了文件并运行了命令';
  if (edits) return '编辑了文件';
  if (names.has('bash')) return '运行了命令';
  if (names.has('grep')) return '搜索了内容';
  return [...names].every(name => ['read', 'ls', 'find'].includes(name)) ? '查看了文件与项目' : '使用了工具';
}

function ToolCard({ events, running }: { events: AgentEvent[]; running: boolean }) {
  const rows = activities(events);
  const active = running && rows.some(row => !row.done);
  const title = toolTitle(events);
  const confirmed = rows.every(row => row.done && !row.failed);
  return <details className="codex-tool-card" key={String(active)} open={active ? true : undefined}>
    <summary data-scroll-anchor><EditOutlined aria-hidden /><span>{confirmed ? title : title.replace(/了/g, '')}</span><span className="process-chevron" aria-hidden>⌄</span></summary>
    <div className="codex-tool-rows">{rows.map(row => {
      const Icon = row.name === 'bash' ? CodeOutlined : ['write', 'edit'].includes(row.name) ? EditOutlined : row.name === 'grep' ? SearchOutlined : ['read', 'ls', 'find'].includes(row.name) ? FileTextOutlined : ToolOutlined;
      return <div className="codex-tool-row" key={row.id}>
        <Icon aria-hidden /><span className="codex-tool-label">{activityLabel(row.name)}{row.path ? <span className="codex-tool-path"> · {row.path}</span> : ''}</span>
        <small>{row.failed ? '失败' : row.done ? '已完成' : running ? '进行中' : '结果未记录'}</small>
      </div>;
    })}</div>
  </details>;
}

export function taskDuration(task: Task) {
  if (isActive(task) || !task.createdAt || !task.updatedAt) return undefined;
  const duration = Date.parse(task.updatedAt) - Date.parse(task.createdAt);
  if (!Number.isFinite(duration) || duration < 0) return undefined;
  const seconds = Math.floor(duration / 1000);
  return seconds >= 60 ? `用时 ${Math.floor(seconds / 60)}分${seconds % 60}秒` : `用时 ${seconds}秒`;
}

export default function TurnTimeline({ task, events, savedText, messageSlots, onStop }: {
  task: Task; events: AgentEvent[]; savedText?: string; messageSlots?: ReactNode; onStop: () => void;
}) {
  const running = isActive(task);
  const { progress, reply } = projectTimeline(events, savedText, !running && (savedText !== undefined || ['succeeded', 'completed'].includes(task.status)));
  const count = activities(events).length;
  const duration = taskDuration(task);
  const status = statusLabel(task.status);
  const label = ['completed', 'succeeded'].includes(task.status) ? duration ?? status : `${status}${duration ? ` · ${duration}` : ''}`;
  const hasWork = progress.length > 0 || !!task.error || !!task.errorCode || running;
  const work = <>
    {progress.map(step => step.kind === 'text'
      ? step.text.trim() && <div className="codex-narration-card" data-scroll-anchor key={step.id}><MessageContent text={step.text} /></div>
      : <ToolCard key={step.id} events={step.events} running={running} />)}
    {running && progress.length === 0 && <p className="turn-empty-reply">正在处理你的任务…</p>}
    {(task.error || task.errorCode) && <div className="process-error"><strong>错误详情</strong>{task.error && <p>{task.error}</p>}{task.errorCode && <p>错误码：{task.errorCode}</p>}</div>}
    {count > 0 && events.some(event => event.payload.toolName === 'bash' || event.payload.name === 'bash') && <p className="activity-note">文件清单不含命令产生的改动。</p>}
  </>;
  return <>
    <section className="codex-turn-work" aria-label="实际工具轨迹">
      <div className="codex-work-control">
        {hasWork ? <details className="codex-work-log" key={String(running)} open={running ? true : undefined}>
          <summary data-scroll-anchor><span role={task.status === 'failed' ? 'alert' : 'status'} title={duration ? '用时依据任务创建与最后状态更新时间，包含排队时间' : undefined}>{label}</span><span className="process-chevron" aria-hidden>⌄</span></summary>
          <div className="codex-work-steps">{work}</div>
        </details> : <div className="codex-run-label" role={task.status === 'failed' ? 'alert' : 'status'} data-scroll-anchor>{label}</div>}
        {running && <Button type="text" size="small" danger aria-label="停止此任务" onClick={onStop}>停止</Button>}
      </div>
    </section>
    {(reply?.trim() || (!running && changedFiles(events).length > 0)) && <section className="codex-final-card" aria-label="本轮结果" data-scroll-anchor>
      {reply?.trim() && <MessageContent text={reply} />}
      <TaskFiles events={events} finished={!running} />
    </section>}
    {messageSlots}
  </>;
}
