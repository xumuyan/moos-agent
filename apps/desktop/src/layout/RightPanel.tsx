/** Presentation adapted from DeepSeek Harness SidebarRight SidebarPanel/PanelChrome and
 * DockKit TabLayout/TabPanel at fcc0ad4. Copyright (c) 2026 DeepSeek, MIT.
 * The Moos adapter supplies one fixed dock, actual task data and plugin slots. */
import { Fragment, useContext, useId, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { SlotHost } from '../plugins/slots';
import { changedFiles, activities } from '../conversation/activity';
import { statusLabel, type AgentEvent } from '../types';
import { IconAppsAddOutlineRegular, IconClockOutlineRegular, IconCodeOutlineRegular, IconFolderOpenOutlineRegular, IconPanelLeftOutlineRegular } from '../vendor/dsh/primitives/icons/index';
import { RightPanelFrame } from '../vendor/dsh/rightpanel/RightPanelFrame';
import { TabTitle } from '../vendor/dsh/rightpanel/TabTitle';
import css from '../vendor/dsh/rightpanel/SidebarRight.module.css';
import dock from '../vendor/dsh/rightpanel/dockkit.module.css';
import bridge from '../vendor/dsh/rightpanel/RightPanelBridge.module.css';

const tabs = [
  { id: 'files', label: '变更', Icon: IconFolderOpenOutlineRegular },
  { id: 'task', label: '任务', Icon: IconClockOutlineRegular },
  { id: 'plugins', label: '插件', Icon: IconAppsAddOutlineRegular },
] as const;

type Tab = typeof tabs[number]['id'];

export default function RightPanel({ projectName, projectPath, activeTasks, events = [], taskStatus, onClose }: {
  projectName?: string; projectPath?: string; activeTasks: number; events?: AgentEvent[]; taskStatus?: string; onClose?: () => void;
}) {
  const frame = useContext(RightPanelFrame);
  const paneId = useId();
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState<Tab>('files');
  const [opening, setOpening] = useState(true);
  const files = changedFiles(events);
  const shown = frame?.open ?? true;
  const width = frame ? `${frame.width}px` : '100%';
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.nativeEvent.isComposing) return;
    const index = tabs.findIndex(item => item.id === tab);
    const next = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (index + tabs.length - 1) % tabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0 || !(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'tab') return;
    event.preventDefault();
    setTab(tabs[next].id);
    event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };
  return <aside className={`right-panel ${css.panel}${collapsed ? ' collapsed' : ''}`} aria-label="上下文面板"
    style={{ width, '--dsh-sidebar-width': width } as CSSProperties}
    data-sidebar-right-panel="push" data-sidebar-right-open={shown || undefined}
    data-sidebar-right-opening={shown && opening || undefined} aria-hidden={!shown || undefined}
    onTransitionEnd={opening ? () => setOpening(false) : undefined}>
    <div className={css.panelBody}>
      <div className={dock.surface}>
        <div className={dock.tabLayout} style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
          <div className={dock.tabCell} data-dockkit-host="dock" data-dockkit-column="0">
            <section className={`${dock.tabHost} ${dock.pane}`} data-dockkit-pane={paneId} data-dockkit-pane-active data-dockkit-column="0">
              <div className={dock.tabHostHeader}>
                <div className={`${dock.tabStrip} ${bridge.strip}`} role="tablist" aria-label="工具面板分区" data-dockkit-strip={paneId} onKeyDown={navigate}>
                  <div className={dock.stripTabs} role="presentation" data-dockkit-strip-tabs={paneId} hidden={collapsed}>
                    {tabs.map(({ id, label, Icon }, index) => <Fragment key={id}>
                      {index > 0 && <div className={dock.slot} aria-hidden="true" />}
                      <div className={`${dock.tab} ${id === tab ? dock.tabActive : ''}`} role="tab" data-dockkit-tab={id}
                        tabIndex={id === tab ? 0 : -1} aria-selected={id === tab}
                        aria-controls={`${paneId}-panel`} id={`${paneId}-${id}`} onClick={() => setTab(id)}
                        onFocus={event => event.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })}
                        onKeyDown={event => {
                          if ((event.key === 'Enter' || event.key === ' ') && !event.nativeEvent.isComposing) {
                            event.preventDefault();
                            setTab(id);
                          }
                        }}>
                        <TabTitle><span className={css.tabTitle} data-sidebar-right-tab={id}><Icon size={14} aria-hidden="true" />{label}</span></TabTitle>
                      </div>
                    </Fragment>)}
                  </div>
                  <div className={dock.stripFill} data-dockkit-strip-fill />
                  <div className={dock.stripChrome} data-dockkit-strip-chrome>
                    <button type="button" className={css.iconButton} data-sidebar-right-toggle
                      aria-label={collapsed ? '展开上下文面板' : '收起上下文面板'}
                      onClick={() => onClose ? onClose() : setCollapsed(value => !value)}>
                      <IconPanelLeftOutlineRegular className={collapsed ? undefined : css.collapseGlyph} />
                    </button>
                  </div>
                </div>
              </div>
              <div className={`${dock.tabHostBody} ${dock.paneBody}`} hidden={collapsed}>
                <div className={css.tabBody} data-sidebar-right-tab={tab}>
                  <div className={bridge.content} role="tabpanel" tabIndex={0} id={`${paneId}-panel`} aria-labelledby={`${paneId}-${tab}`}>
                    <div className={bridge.heading}><span>本轮变更</span><strong>{files.length} 个文件</strong><span className={bridge.muted}>{taskStatus ? statusLabel(taskStatus) : '尚无任务'}</span></div>
                    {tab === 'files' && <section aria-label="本轮修改文件">
                      {files.map(file => <div className={bridge.file} key={file.path}><span>{file.path}</span><small className={bridge.muted}>{file.description}</small></div>)}
                      {!files.length && <p className={bridge.muted}>尚无已确认的文件修改</p>}
                      {activities(events).some(row => row.name === 'bash') && <p className={bridge.muted}>命令产生的文件变化尚未统计。</p>}
                    </section>}
                    {tab === 'task' && <dl className={bridge.task}>
                      <div><dt>工作区</dt><dd>{projectName ?? '未选择项目'}</dd></div>
                      <div><dt><IconFolderOpenOutlineRegular size={14} aria-hidden="true" /> 工作目录</dt><dd>{projectPath ?? '选择项目后显示'}</dd></div>
                      <div><dt><IconCodeOutlineRegular size={14} aria-hidden="true" /> 当前任务</dt><dd>{activeTasks ? `${activeTasks} 个执行中` : '暂无执行中任务'}</dd></div>
                    </dl>}
                    {tab === 'plugins' && <><p className={bridge.muted}>已启用插件的工具面板</p><SlotHost slot="rightPanel.tab" context={{ projectName, projectPath, activeTasks }} /></>}
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  </aside>;
}
