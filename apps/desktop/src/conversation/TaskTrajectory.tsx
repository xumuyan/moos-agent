import type { AgentEvent } from '../types';
import { activities, activityLabel, changedFiles } from './activity';

export default function TaskTrajectory({ events, finished = false }: { events: AgentEvent[]; finished?: boolean }) {
  const rows = activities(events);
  const files = changedFiles(events);
  if (!rows.length) return null;
  return <section className="task-trajectory" aria-label="实际工具轨迹">
    <details className="activity-history" open={finished ? undefined : true} key={String(finished)}>
      <summary>{finished ? '查看执行过程' : '执行过程'} · {rows.length} 项操作</summary>
      <div className="activity-list">{rows.map(row => <div className="activity-row" key={row.id}>
        <span aria-hidden="true">{row.failed ? '!' : row.done ? '✓' : '·'}</span>
        <span>{activityLabel(row.name)}{row.path ? ` · ${row.path}` : ''}</span>
        <small>{row.failed ? '失败' : row.done ? '已完成' : finished ? '结果未记录' : '进行中'}</small>
      </div>)}</div>
    </details>
    {finished && files.length > 0 && <section className="changed-files" aria-label="修改文件汇总">
      <strong>已修改 {files.length} 个文件</strong>
      {files.map(file => <div className="changed-file" key={file.path}><span>{file.path}</span><small>{file.description}</small></div>)}
    </section>}
    {finished && rows.some(row => row.name === 'bash') && <p className="activity-note">文件清单仅统计成功的写入与编辑工具；命令产生的文件改动未统计。</p>}
  </section>;
}
