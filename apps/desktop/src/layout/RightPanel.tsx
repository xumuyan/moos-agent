import { CodeOutlined, FolderOpenOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import { useState } from 'react';
import { SlotHost } from '../plugins/slots';
import { changedFiles, activities } from '../conversation/activity';
import { statusLabel, type AgentEvent } from '../types';

export default function RightPanel({ projectName, projectPath, activeTasks, events = [], taskStatus }: {
  projectName?: string;
  projectPath?: string;
  activeTasks: number;
  events?: AgentEvent[];
  taskStatus?: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return <aside className={`right-panel ${collapsed ? 'collapsed' : ''}`} aria-label="上下文面板">
    <Button className="right-panel-toggle" size="small" type="text" aria-label={collapsed ? '展开上下文面板' : '收起上下文面板'} onClick={() => setCollapsed(value => !value)}>{collapsed ? '‹' : '›'}</Button>
    <div className="right-panel-content">
    <div className="right-panel-heading"><span className="eyebrow">本轮变更</span><strong>{changedFiles(events).length} 个文件</strong><span className="muted">{taskStatus ? statusLabel(taskStatus) : '尚无任务'}</span></div>
    <section className="workbench-changes" aria-label="本轮修改文件">
      {changedFiles(events).map(file => <div className="workbench-file" key={file.path}><span>{file.path}</span><small>{file.description}</small></div>)}
      {!changedFiles(events).length && <p className="muted">尚无已确认的文件修改</p>}
      {activities(events).some(row => row.name === 'bash') && <p className="right-panel-note">命令产生的文件变化尚未统计。</p>}
    </section>
    <dl className="context-summary">
      <div><dt>工作区</dt><dd>{projectName ?? '未选择项目'}</dd></div>
      <div><dt><FolderOpenOutlined /> 工作目录</dt><dd>{projectPath ?? '选择项目后显示'}</dd></div>
      <div><dt><CodeOutlined /> 当前任务</dt><dd>{activeTasks ? `${activeTasks} 个执行中` : '暂无执行中任务'}</dd></div>
    </dl>
    <p className="right-panel-note">这里只显示 Moos 已验证的项目和任务状态。</p>
    <SlotHost slot="rightPanel.tab" context={{ projectName, projectPath, activeTasks }} />
    </div>
  </aside>;
}
