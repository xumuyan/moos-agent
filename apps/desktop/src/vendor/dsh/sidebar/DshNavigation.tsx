/** Direct presentation extraction from DSH SidebarRoot / WorkspaceBrowser / Rows.
 * Copyright (c) 2026 DeepSeek, MIT. See source-map.json and THIRD_PARTY_NOTICES.md.
 * Moos owns project and session commands. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import {
  IconPanelLeftOutlineRegular, IconNewChatOutlineMedium, IconFolderCloseRegular, IconFolderOpenRegular,
  IconProjectAddOutlineRegular, IconSettingsOutlineMedium, IconTriangleRightFillRegular,
} from '../primitives/icons/index';
import css from './SidebarRoot.module.css';
import browser from './WorkspaceBrowser.module.css';
import rows from './Rows.module.css';
import icon from '../../../moos-icon.png';
import type { ProjectView } from '../../../ui-adapter/types';

export interface DshNavigationProps {
  wide: boolean;
  fading?: boolean;
  railEntering?: boolean;
  toggle: () => void;
  projects: ProjectView[];
  conversations: ReactNode;
  onProject: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
  onNew: () => void;
  newDisabled: boolean;
  onSettings: () => void;
  panels: { id: string; label: string; icon: ReactNode; onClick: () => void }[];
  primary?: ReactNode;
  footer?: ReactNode;
}

export default function DshNavigation(props: DshNavigationProps) {
  const [pointerInside, setPointerInside] = useState(false);
  const linger = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(linger.current), []);

  return (
    <aside
      aria-label="工作区与会话"
      className={clsx('workspace-sidebar',css.root, !props.wide && css.collapsed, props.fading && css.fading,
        props.railEntering && css.railIn, !pointerInside && css.quietBars)}
      onMouseEnter={() => {
        clearTimeout(linger.current);
        setPointerInside(true);
      }}
      onMouseLeave={() => {
        clearTimeout(linger.current);
        linger.current = setTimeout(() => setPointerInside(false), 2000);
      }}
    >
      <div className={css.topStrip} data-tauri-drag-region>
        <button type="button" className={clsx(css.iconButton, css.toggle)}
          aria-label={props.wide ? '收起侧栏' : '展开侧栏'} aria-expanded={props.wide} onClick={props.toggle}>
          <IconPanelLeftOutlineRegular size={props.wide ? 16 : 18} />
        </button>
      </div>
      <div className={css.logoRow} data-tauri-drag-region inert={props.fading}>
        {props.wide && <span className={clsx(css.brand, css.wide)}>
          <span className={css.brandIdentity}>
            <span className={css.brandMark}><img src={icon} alt="" width={24} height={24} /></span>
            <span className={css.brandName}>Moos</span>
          </span>
        </span>}
      </div>
      <button type="button" inert={props.fading} className={css.newSession} aria-label="新建会话"
        disabled={props.newDisabled} onClick={props.onNew}>
        <span className={css.newSessionLabelMask}>
          <span className={css.newSessionContent}>
            <IconNewChatOutlineMedium size={props.wide ? 14 : 18} />
            {props.wide && <span className={clsx(css.newSessionLabel, css.wide)}>新会话</span>}
          </span>
        </span>
      </button>
      <div className={css.scrollRegion} inert={props.fading}>
        <div className={css.scrollArea} data-sidebar-scrollport={props.wide ? '' : undefined}>
          {props.wide && props.primary}
          <nav className={css.panelList} aria-label="全局面板">
            {props.panels.map(panel => (
              <div key={panel.id} className={clsx(css.panelEntry, props.wide && css.panelEntryWide)}>
                <button type="button" className={css.panelRow} aria-label={panel.label} onClick={panel.onClick}>
                  <span className={css.panelGlyph} aria-hidden>{panel.icon}</span>
                  {props.wide && <span className={clsx(css.panelTitle, css.wide)}>{panel.label}</span>}
                </button>
              </div>
            ))}
          </nav>
          <div className={css.regionArea}>
            <div className={clsx(browser.root, !props.wide && browser.rail)}>
              <div className={browser.sectionHeader} data-sidebar-workspace-header="">
                {props.wide && <>
                  <span className={clsx(browser.sectionLabel, browser.wide)}>工作区</span>
                  <div className={browser.searchSlot} aria-hidden="true" />
                </>}
                <div className={browser.headerActions}>
                  <button type="button" className={browser.iconButton} aria-label="添加项目" onClick={props.onAdd}>
                    <IconProjectAddOutlineRegular size={16} />
                  </button>
                </div>
              </div>
              <div className={browser.listArea}>
                <div className={browser.treeBody}>
                  <nav aria-label="项目列表" className={browser.list}>
                    {props.projects.map(project => (
                      <div key={project.id}>
                        <div className={rows.projectRow} data-row-key={`workspace:${project.id}`} role="button" tabIndex={0}
                          aria-label={props.wide ? project.name : `切换到项目 ${project.name}`}
                          aria-current={project.selected || undefined} title={project.path}
                          onClick={() => props.onProject(project.id)}
                          onKeyDown={event => {
                            if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return;
                            event.preventDefault();
                            props.onProject(project.id);
                          }}>
                          <span className={clsx(rows.slot, rows.folder, project.selected && rows.folderActive)} aria-hidden="true">
                            {project.selected ? <IconFolderOpenRegular /> : <IconFolderCloseRegular />}
                          </span>
                          <span className={clsx(rows.slot, rows.chevron)} aria-hidden="true">
                            <IconTriangleRightFillRegular className={clsx(rows.arrow, project.selected && rows.arrowOpen)} />
                          </span>
                          {props.wide && <span className={rows.projectText}>
                            <span className={rows.title}>
                              {project.name}{project.runningTasks > 0 && ` · ${project.runningTasks}`}
                            </span>
                          </span>}
                          {props.wide && <span className={rows.rowActions}>
                            <button type="button" className={rows.iconButton} aria-label={`移除项目 ${project.name}`}
                              onClick={event => {
                                event.stopPropagation();
                                props.onRemove(project.id);
                              }}>×</button>
                          </span>}
                        </div>
                        {props.wide && project.selected && props.conversations}
                      </div>
                    ))}
                  </nav>
                </div>
              </div>
            </div>
          </div>
        </div>
        <span className={css.scrollFade} aria-hidden />
      </div>
      <div className={css.footArea} inert={props.fading}>
        <div className={css.footerActions}>{props.footer}</div>
        <div className={css.settingsArea}>
          <button type="button" className={css.panelRow} aria-label="打开设置中心" onClick={props.onSettings}>
            <span className={css.panelGlyph} aria-hidden><IconSettingsOutlineMedium size={16} /></span>
            {props.wide && <span className={css.panelTitle}>设置</span>}
          </button>
        </div>
      </div>
    </aside>
  );
}
