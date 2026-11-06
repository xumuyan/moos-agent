import { Button } from 'antd';
import { isActive, statusLabel, type Task } from '../types';

export default function TaskStatus({ task, onStop }: { task: Task; onStop: () => void }) {
  const failed = task.status === 'failed';
  return <div className={`turn-status ${failed ? 'turn-status-failed' : ''}`}>
    <div className="turn-status-line" role={failed ? 'alert' : 'status'}>
      <span className={`task-status-dot ${isActive(task) ? 'is-running' : ''}`} aria-hidden="true" />
      <span>{failed ? '任务执行失败' : statusLabel(task.status)}</span>
      {isActive(task) && <Button type="text" size="small" danger aria-label="停止此任务" onClick={onStop}>停止</Button>}
    </div>
    {(task.error || task.errorCode) && <details className="turn-error-details">
      <summary>查看错误详情</summary>
      {task.error && <p>{task.error}</p>}
      {task.errorCode && <p>错误码：{task.errorCode}</p>}
    </details>}
  </div>;
}
