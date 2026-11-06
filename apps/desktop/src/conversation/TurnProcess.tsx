import { Button } from 'antd';
import { activities } from './activity';
import { ActivityList } from './TaskTrajectory';
import { isActive, statusLabel, type AgentEvent, type Task } from '../types';

export default function TurnProcess({ task, events, onStop }: { task: Task; events: AgentEvent[]; onStop: () => void }) {
  const running = isActive(task);
  const count = activities(events).length;
  const hasDetails = count > 0 || !!task.error || !!task.errorCode;
  const label = <><span className={`task-status-dot ${running ? 'is-running' : ''}`} aria-hidden="true" /><span role={task.status === 'failed' ? 'alert' : 'status'}>{statusLabel(task.status)}{count > 0 ? ` · ${count} 项操作` : ''}</span></>;
  return <section className={`turn-process ${task.status === 'failed' ? 'turn-process-failed' : ''}`} aria-label="实际工具轨迹">
    <div className="turn-process-control">
      {hasDetails ? <details key={String(running)} open={running ? true : undefined}>
        <summary data-scroll-anchor>{label}<span className="process-chevron" aria-hidden="true">⌄</span></summary>
        <ActivityList events={events} finished={!running} />
        {(task.error || task.errorCode) && <div className="process-error"><strong>错误详情</strong>{task.error && <p>{task.error}</p>}{task.errorCode && <p>错误码：{task.errorCode}</p>}</div>}
      </details> : <div className="process-static" data-scroll-anchor>{label}</div>}
      {running && <Button type="text" size="small" danger aria-label="停止此任务" onClick={onStop}>停止</Button>}
    </div>
  </section>;
}
