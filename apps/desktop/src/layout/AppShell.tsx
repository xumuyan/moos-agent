import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import { clampWidth, computeColumns, SIDEBAR_DEFAULT, SIDEBAR_MIN, SIDEBAR_MAX, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_DRAWER_BREAKPOINT, RIGHTBAR_MIN, RIGHTBAR_DEFAULT_RATIO, RIGHTBAR_MAX_RATIO } from './dsh-columns';

export default function AppShell({ rail, sidebar, conversation, rightPanel, preferredRightWidth }: {
  rail?: ReactNode; sidebar: ReactNode; conversation: ReactNode; rightPanel?: ReactNode; preferredRightWidth?: number;
}) {
  const [width, setWidth] = useState(() => window.innerWidth);
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < SIDEBAR_AUTO_COLLAPSE);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [rightWidth, setRightWidth] = useState(() => Math.max(RIGHTBAR_MIN, window.innerWidth * RIGHTBAR_DEFAULT_RATIO));
  useEffect(() => { if (preferredRightWidth !== undefined && Number.isFinite(preferredRightWidth)) setRightWidth(Math.max(RIGHTBAR_MIN, preferredRightWidth)); }, [preferredRightWidth]);
  const drag = useRef<{ side: 'sidebar' | 'right'; start: number; width: number } | undefined>(undefined);
  useEffect(() => {
    const resize = () => { setWidth(window.innerWidth); if (window.innerWidth < SIDEBAR_AUTO_COLLAPSE) setCollapsed(true); };
    window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize);
  }, []);
  const overlaySidebar = width < SIDEBAR_DRAWER_BREAKPOINT && !collapsed;
  const columns = computeColumns(width, collapsed || overlaySidebar ? 0 : sidebarWidth, rightPanel ? rightWidth : 0);
  const overlayRight = !!rightPanel && columns.rightbar === 0;
  const separator = (side: 'sidebar' | 'right') => <div role="separator" tabIndex={0} aria-label={side === 'sidebar' ? '调整侧栏宽度' : '调整工具面板宽度'} aria-orientation="vertical" aria-valuemin={side === 'sidebar' ? SIDEBAR_MIN : RIGHTBAR_MIN} aria-valuemax={side === 'sidebar' ? SIDEBAR_MAX : Math.max(RIGHTBAR_MIN, width * RIGHTBAR_MAX_RATIO)} aria-valuenow={Math.round(side === 'sidebar' ? sidebarWidth : rightWidth)}
    className={`dsh-resize-handle dsh-resize-${side}`}
    onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { side, start: event.clientX, width: side === 'sidebar' ? sidebarWidth : rightWidth }; }}
    onPointerMove={event => { const current = drag.current; if (!current || current.side !== side) return; const delta = event.clientX - current.start; if (side === 'sidebar') setSidebarWidth(clampWidth(current.width + delta, SIDEBAR_MIN, SIDEBAR_MAX)); else setRightWidth(clampWidth(current.width - delta, RIGHTBAR_MIN, Math.max(RIGHTBAR_MIN, width * RIGHTBAR_MAX_RATIO))); }}
    onPointerUp={() => { drag.current = undefined; }} onPointerCancel={() => { drag.current = undefined; }} onLostPointerCapture={() => { drag.current = undefined; }}
    onDoubleClick={() => side === 'sidebar' ? setSidebarWidth(SIDEBAR_DEFAULT) : setRightWidth(Math.max(RIGHTBAR_MIN, width * RIGHTBAR_DEFAULT_RATIO))}
    onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return; event.preventDefault(); const step = event.key === 'ArrowLeft' ? -16 : 16; if (side === 'sidebar') setSidebarWidth(event.key === 'Home' ? SIDEBAR_DEFAULT : clampWidth(sidebarWidth + step, SIDEBAR_MIN, SIDEBAR_MAX)); else setRightWidth(event.key === 'Home' ? Math.max(RIGHTBAR_MIN, width * RIGHTBAR_DEFAULT_RATIO) : clampWidth(rightWidth - step, RIGHTBAR_MIN, Math.max(RIGHTBAR_MIN, width * RIGHTBAR_MAX_RATIO))); }} />;
  return <div className={`desktop-shell app-shell dsh-shell ${collapsed ? 'is-sidebar-collapsed' : ''} ${overlayRight ? 'has-overlay-right' : ''} ${overlaySidebar ? 'has-overlay-sidebar' : ''}`} style={{ '--dsh-sidebar-width': `${overlaySidebar ? Math.min(sidebarWidth, width - 56) : columns.sidebar}px`, '--dsh-right-width': `${overlayRight ? Math.min(width - 72, rightWidth) : columns.rightbar}px` } as CSSProperties}>
    <div className="dsh-navigation">
      <button className="dsh-sidebar-toggle" aria-label={collapsed ? '展开侧栏' : '收起侧栏'} aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>{collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}</button>
      {rail}<div className="dsh-sidebar-body" hidden={collapsed}>{sidebar}</div>
      {!collapsed && separator('sidebar')}
    </div>
    {overlaySidebar && <button className="dsh-sidebar-shade" aria-label="关闭侧栏覆盖层" onClick={() => setCollapsed(true)} />}
    {conversation}
    {rightPanel && <div className="dsh-right-column">{!overlayRight && separator('right')}{rightPanel}</div>}
  </div>;
}
