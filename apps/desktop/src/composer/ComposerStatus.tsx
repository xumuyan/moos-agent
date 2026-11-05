import { FolderOpenOutlined } from '@ant-design/icons';
import type { UsageContext } from '../types';

export default function ComposerStatus({ projectName, backgroundTasks, usage }: { projectName?: string; backgroundTasks: number; usage?: UsageContext }) {
  const ratio = usage?.contextWindow ? usage.totalTokens / usage.contextWindow : null;
  const level = ratio === null ? '' : ratio >= 0.95 ? 'usage-critical' : ratio >= 0.85 ? 'usage-warning' : ratio >= 0.7 ? 'usage-notice' : '';
  return <div className="composer-context">
    <span><FolderOpenOutlined /> {projectName ?? '未选择项目'}</span>
    <span>缓存命中 {usage?.cacheHitRate === null || usage?.cacheHitRate === undefined ? '暂无数据' : `${(usage.cacheHitRate * 100).toFixed(1)}%`}</span>
    <span className={level}>上下文 {usage?.contextWindow ? `${usage.totalTokens.toLocaleString()} / ${usage.contextWindow.toLocaleString()}` : '暂无数据'}</span>
    <span>{backgroundTasks} 个后台任务</span>
  </div>;
}
