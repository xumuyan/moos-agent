import { CodeOutlined, FolderOpenOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import { useState } from 'react';

export default function RightPanel({ projectName, projectPath, activeTasks }: {
  projectName?: string;
  projectPath?: string;
  activeTasks: number;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return <aside className={`right-panel ${collapsed ? 'collapsed' : ''}`} aria-label="上下文面板">
    <Button className="right-panel-toggle" size="small" type="text" aria-label={collapsed ? '展开上下文面板' : '收起上下文面板'} onClick={() => setCollapsed(value => !value)}>{collapsed ? '‹' : '›'}</Button>
    <div className="right-panel-content">
    <div className="right-panel-heading"><span className="eyebrow">当前上下文</span><strong>{projectName ?? '未选择项目'}</strong></div>
    <dl className="context-summary">
      <div><dt><FolderOpenOutlined /> 工作目录</dt><dd>{projectPath ?? '选择项目后显示'}</dd></div>
      <div><dt><CodeOutlined /> 当前任务</dt><dd>{activeTasks ? `${activeTasks} 个执行中` : '暂无执行中任务'}</dd></div>
    </dl>
    <p className="right-panel-note">这里只显示 Moos 已验证的项目和任务状态。</p>
    </div>
  </aside>;
}
