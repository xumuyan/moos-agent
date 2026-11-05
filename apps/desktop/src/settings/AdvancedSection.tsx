import { Alert, Select } from 'antd';
import type { RuntimeConfig } from '../types';

const labels: Record<number, string> = {
  600000: '10 分钟', 1800000: '30 分钟', 3600000: '1 小时', 7200000: '2 小时',
  21600000: '6 小时', 86400000: '24 小时',
};

export default function AdvancedSection({ runtime, onTaskTimeoutChange }: {
  runtime: RuntimeConfig;
  onTaskTimeoutChange: (value: number) => Promise<boolean>;
}) {
  return <section><h3>高级</h3>
    <label htmlFor="task-timeout">单任务运行时长上限</label>
    <Select id="task-timeout" aria-label="单任务运行时长上限" value={runtime.taskTimeoutMs} style={{ width: 220 }}
      options={runtime.allowedTaskTimeouts.map(value => ({ value, label: labels[value] ?? `${value} ms` }))}
      onChange={value => void onTaskTimeoutChange(value)} />
    <p className="muted">默认 2 小时；不允许无限执行。新设置只影响之后提交的任务。</p>
    <Alert type="info" showIcon message="单一 PI 运行时已启用" description="运行中任务会记录阶段和存活心跳；心跳不是模型输出。应用重启不会自动重放未完成任务。原生终端仍在后续阶段。" />
  </section>;
}
