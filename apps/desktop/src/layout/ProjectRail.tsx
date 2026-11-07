import { Button, Tooltip } from 'antd';
import { FolderAddOutlined, SettingOutlined } from '@ant-design/icons';
import type { Project } from '../types';
import moosIcon from '../moos-icon.png';

export default function ProjectRail({ projects, selectedId, onSelect, onAdd, onSettings, adding }: {
  projects: Project[]; selectedId: string; onSelect: (id: string) => void;
  onAdd: () => void; onSettings: () => void; adding: boolean;
}) {
  return <nav className="project-rail" aria-label="项目工具栏">
    <span className="rail-brand" aria-label="Moos"><img src={moosIcon} alt="" /><strong>Moos</strong></span>
    <div className="rail-projects">{projects.map(project => <Tooltip title={project.name} placement="right" key={project.id}>
      <button className={`rail-project ${project.id === selectedId ? 'selected' : ''}`} aria-label={`切换到项目 ${project.name}`} aria-current={project.id === selectedId ? 'page' : undefined} onClick={() => onSelect(project.id)}>{Array.from(project.name)[0]?.toUpperCase()}</button>
    </Tooltip>)}
    </div><Tooltip title="添加工作区" placement="right"><Button type="text" icon={<FolderAddOutlined />} aria-label="添加工作区" disabled={adding} onClick={onAdd} /></Tooltip>
    <div className="rail-spacer" />
    <Tooltip title="设置" placement="right"><Button type="text" icon={<SettingOutlined />} aria-label="打开设置中心" onClick={onSettings} /></Tooltip>
  </nav>;
}
