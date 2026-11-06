import type { AgentEvent } from '../types';
import { useState } from 'react';
import { FileTextOutlined } from '@ant-design/icons';
import { activities, activityGroups, activityLabel, changedFiles } from './activity';

export function ActivityList({ events, finished }: { events: AgentEvent[]; finished: boolean }) {
  const groups = activityGroups(events);
  return <div className="activity-groups">{groups.map(group => <section className="activity-group" aria-label={`${group.label}工具组`} key={group.id}>
    <div className="activity-group-heading"><strong>{group.label}</strong><span>{group.rows.length} 项</span></div>
    <div className="activity-list">{group.rows.map(row => <div className="activity-row" key={row.id}>
      <span aria-hidden="true">{row.failed ? '!' : row.done ? '✓' : '·'}</span>
      <span>{activityLabel(row.name)}{row.path ? ` · ${row.path}` : ''}</span>
      <small>{row.failed ? '失败' : row.done ? '已完成' : finished ? '结果未记录' : '进行中'}</small>
    </div>)}</div>
  </section>)}
    {finished && groups.some(group => group.rows.some(row => row.name === 'bash')) && <p className="activity-note">文件清单仅统计成功的写入与编辑工具；命令产生的文件改动未统计。</p>}
  </div>;
}

export function TaskFiles({ events, finished = false }: { events: AgentEvent[]; finished?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const files = changedFiles(events);
  if (!finished || !files.length) return null;
  return <>
    <section className="changed-files" aria-label="修改文件汇总" data-scroll-anchor>
      <strong><FileTextOutlined aria-hidden /> 已修改 {files.length} 个文件</strong>
      {(expanded ? files : files.slice(0, 3)).map(file => <div className="changed-file" key={file.path}><span>{file.path}</span><small>{file.description}</small></div>)}
      {files.length > 3 && <button className="changed-files-more" data-preserve-scroll aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? '收起文件列表' : `再显示 ${files.length - 3} 个文件`} <span aria-hidden>⌄</span></button>}
    </section>
    {activities(events).some(row => row.name === 'bash') && <p className="activity-note">文件清单不含命令产生的改动。</p>}
  </>;
}

export default function TaskTrajectory({ events, finished = false, includeFiles = true }: { events: AgentEvent[]; finished?: boolean; includeFiles?: boolean }) {
  const rows = activities(events);
  if (!rows.length) return null;
  return <section className="task-trajectory" aria-label="实际工具轨迹">
    <details className="activity-history" open={finished ? undefined : true} key={String(finished)}>
      <summary>{finished ? '查看执行过程' : '执行过程'} · {rows.length} 项操作</summary>
      <ActivityList events={events} finished={finished} />
    </details>
    {includeFiles && <TaskFiles events={events} finished={finished} />}
  </section>;
}
