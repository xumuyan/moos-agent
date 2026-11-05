import { CodeOutlined, FolderOpenOutlined } from '@ant-design/icons';

export default function RightPanel({ projectName, projectPath, activeTasks }: {
  projectName?: string;
  projectPath?: string;
  activeTasks: number;
}) {
  return <aside className="right-panel" aria-label="上下文面板">
    <div className="right-panel-heading"><span className="eyebrow">当前上下文</span><strong>{projectName ?? '未选择项目'}</strong></div>
    <dl className="context-summary">
      <div><dt><FolderOpenOutlined /> 工作目录</dt><dd>{projectPath ?? '选择项目后显示'}</dd></div>
      <div><dt><CodeOutlined /> 当前任务</dt><dd>{activeTasks ? `${activeTasks} 个执行中` : '暂无执行中任务'}</dd></div>
    </dl>
    <p className="right-panel-note">这里只显示 Moos 已验证的项目和任务状态。</p>
  </aside>;
}
