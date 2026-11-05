import { FolderOpenOutlined } from '@ant-design/icons';

export default function ComposerStatus({ projectName, backgroundTasks }: { projectName?: string; backgroundTasks: number }) {
  return <div className="composer-context">
    <span><FolderOpenOutlined /> {projectName ?? '未选择项目'}</span>
    <span>{backgroundTasks} 个后台任务</span>
  </div>;
}
