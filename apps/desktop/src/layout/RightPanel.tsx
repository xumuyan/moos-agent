import { CodeOutlined, FolderOpenOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import { useState } from 'react';
import { SlotHost } from '../plugins/slots';
import { changedFiles, activities } from '../conversation/activity';
import { statusLabel, type AgentEvent } from '../types';

export default function RightPanel({ projectName, projectPath, activeTasks, events = [], taskStatus, onClose }: {
  projectName?: string; projectPath?: string; activeTasks: number; events?: AgentEvent[]; taskStatus?: string; onClose?: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState('files');
  return <aside className={`right-panel ${collapsed ? 'collapsed' : ''}`} aria-label="上下文面板">
    <Button className="right-panel-toggle" size="small" type="text" aria-label={collapsed ? '展开上下文面板' : '收起上下文面板'} onClick={() => onClose ? onClose() : setCollapsed(value => !value)}>{collapsed ? '‹' : '›'}</Button>
    <div className="right-panel-content">
      <nav className="right-panel-tabs" role="tablist" aria-label="工具面板分区" onKeyDown={event => {
        const ids = ['files', 'task', 'plugins']; const index = ids.indexOf(tab);
        const next = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (index + 1) % ids.length
          : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (index + ids.length - 1) % ids.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : -1;
        if (next < 0) return; event.preventDefault(); setTab(ids[next]);
        event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
      }}>{[['files','变更'],['task','任务'],['plugins','插件']].map(([id, label]) => <button key={id} role="tab" tabIndex={tab === id ? 0 : -1} aria-selected={tab === id} aria-controls={`right-panel-${id}`} id={`right-panel-tab-${id}`} onClick={() => setTab(id)}>{label}</button>)}</nav>
      <div role="tabpanel" tabIndex={0} id={`right-panel-${tab}`} aria-labelledby={`right-panel-tab-${tab}`}>
        <div className="right-panel-heading"><span className="eyebrow">本轮变更</span><strong>{changedFiles(events).length} 个文件</strong><span className="muted">{taskStatus ? statusLabel(taskStatus) : '尚无任务'}</span></div>
        {tab === 'files' && <section className="workbench-changes" aria-label="本轮修改文件">
          {changedFiles(events).map(file => <div className="workbench-file" key={file.path}><span>{file.path}</span><small>{file.description}</small></div>)}
          {!changedFiles(events).length && <p className="muted">尚无已确认的文件修改</p>}
          {activities(events).some(row => row.name === 'bash') && <p className="right-panel-note">命令产生的文件变化尚未统计。</p>}
        </section>}
        {tab === 'task' && <dl className="context-summary">
          <div><dt>工作区</dt><dd>{projectName ?? '未选择项目'}</dd></div>
          <div><dt><FolderOpenOutlined /> 工作目录</dt><dd>{projectPath ?? '选择项目后显示'}</dd></div>
          <div><dt><CodeOutlined /> 当前任务</dt><dd>{activeTasks ? `${activeTasks} 个执行中` : '暂无执行中任务'}</dd></div>
        </dl>}
        {tab === 'plugins' && <><p className="right-panel-note">已启用插件的工具面板</p><SlotHost slot="rightPanel.tab" context={{ projectName, projectPath, activeTasks }} /></>}
      </div>
    </div>
  </aside>;
}
