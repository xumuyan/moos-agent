import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import { clampWidth, computeColumns, SIDEBAR_DEFAULT, SIDEBAR_MIN, SIDEBAR_MAX, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_DRAWER_BREAKPOINT, RIGHTBAR_MIN, RIGHTBAR_DEFAULT_RATIO, RIGHTBAR_MAX_RATIO } from './dsh-columns';

export default function AppShell({ rail, sidebar, conversation, rightPanel, preferredRightWidth }: {
  rail?: ReactNode; sidebar: ReactNode; conversation: ReactNode; rightPanel?: ReactNode; preferredRightWidth?: number;
}) {
  const [width, setWidth] = useState(() => window.innerWidth);
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < SIDEBAR_AUTO_COLLAPSE);
  const [navigationAnimated, setNavigationAnimated] = useState(false);
  const [railLayout, setRailLayout] = useState(collapsed);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media) return;
    const change = () => setReducedMotion(media.matches);
    media.addEventListener?.('change', change);
    return () => media.removeEventListener?.('change', change);
  }, []);
  useEffect(() => {
    if (!collapsed || reducedMotion) { setRailLayout(collapsed); return; }
    const timer = window.setTimeout(() => setRailLayout(true), 150);
    return () => window.clearTimeout(timer);
  }, [collapsed, reducedMotion]);
  const [retainedRight, setRetainedRight] = useState(rightPanel);
  useEffect(() => {
    if (rightPanel) { setRetainedRight(rightPanel); return; }
    if (reducedMotion) { setRetainedRight(undefined); return; }
    const timer = window.setTimeout(() => setRetainedRight(undefined), 300);
    return () => window.clearTimeout(timer);
  }, [rightPanel, reducedMotion]);
  const rightContent = rightPanel ?? retainedRight;
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
  const lastRightOverlay = useRef(overlayRight);
  useEffect(() => { if (rightPanel) lastRightOverlay.current = overlayRight; }, [rightPanel, overlayRight]);
  const paintedOverlay = rightPanel ? overlayRight : !!rightContent && lastRightOverlay.current;
  const separator = (side: 'sidebar' | 'right') => <div role="separator" tabIndex={0} aria-label={side === 'sidebar' ? '调整侧栏宽度' : '调整工具面板宽度'} aria-orientation="vertical" aria-valuemin={side === 'sidebar' ? SIDEBAR_MIN : RIGHTBAR_MIN} aria-valuemax={side === 'sidebar' ? SIDEBAR_MAX : Math.max(RIGHTBAR_MIN, width * RIGHTBAR_MAX_RATIO)} aria-valuenow={Math.round(side === 'sidebar' ? sidebarWidth : rightWidth)}
    className={`dsh-resize-handle dsh-resize-${side}`}
    onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); drag.current = { side, start: event.clientX, width: side === 'sidebar' ? sidebarWidth : rightWidth }; }}
    onPointerMove={event => { const current = drag.current; if (!current || current.side !== side) return; const delta = event.clientX - current.start; if (side === 'sidebar') setSidebarWidth(clampWidth(current.width + delta, SIDEBAR_MIN, SIDEBAR_MAX)); else setRightWidth(clampWidth(current.width - delta, RIGHTBAR_MIN, Math.max(RIGHTBAR_MIN, width * RIGHTBAR_MAX_RATIO))); }}
    onPointerUp={() => { drag.current = undefined; setDragging(false); }} onPointerCancel={() => { drag.current = undefined; setDragging(false); }} onLostPointerCapture={() => { drag.current = undefined; setDragging(false); }}
    onDoubleClick={() => side === 'sidebar' ? setSidebarWidth(SIDEBAR_DEFAULT) : setRightWidth(Math.max(RIGHTBAR_MIN, width * RIGHTBAR_DEFAULT_RATIO))}
    onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return; event.preventDefault(); const step = event.key === 'ArrowLeft' ? -16 : 16; if (side === 'sidebar') setSidebarWidth(event.key === 'Home' ? SIDEBAR_DEFAULT : clampWidth(sidebarWidth + step, SIDEBAR_MIN, SIDEBAR_MAX)); else setRightWidth(event.key === 'Home' ? Math.max(RIGHTBAR_MIN, width * RIGHTBAR_DEFAULT_RATIO) : clampWidth(rightWidth - step, RIGHTBAR_MIN, Math.max(RIGHTBAR_MIN, width * RIGHTBAR_MAX_RATIO))); }} />;
  return <div className={`desktop-shell app-shell dsh-shell ${navigationAnimated ? 'has-sidebar-motion' : ''} ${collapsed ? 'is-sidebar-collapsed' : ''} ${railLayout ? 'is-rail-layout' : ''} ${collapsed && !railLayout ? 'is-sidebar-fading' : ''} ${dragging ? 'is-resizing' : ''} ${!rightPanel && rightContent ? 'is-right-closing' : ''} ${paintedOverlay ? 'has-overlay-right' : ''} ${overlaySidebar ? 'has-overlay-sidebar' : ''}`} style={{ '--dsh-sidebar-width': `${overlaySidebar ? Math.min(sidebarWidth, width - 56) : columns.sidebar}px`, '--dsh-right-width': `${overlayRight ? Math.min(width - 72, rightWidth) : columns.rightbar}px` } as CSSProperties}>
    <div className="dsh-navigation">
      <div className="dsh-window-drag" data-tauri-drag-region aria-hidden="true" />
      <button className="dsh-sidebar-toggle" aria-label={collapsed ? '展开侧栏' : '收起侧栏'} aria-expanded={!collapsed} onClick={() => { setNavigationAnimated(true); setCollapsed(value => !value); }}>{collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}</button>
      {rail}<div className="dsh-sidebar-body" ref={element => { if (element) element.inert = collapsed; }} aria-hidden={collapsed} hidden={railLayout} style={{ width: sidebarWidth }}>{sidebar}</div>
      {!collapsed && separator('sidebar')}
    </div>
    {overlaySidebar && <button className="dsh-sidebar-shade" aria-label="关闭侧栏覆盖层" onClick={() => setCollapsed(true)} />}
    {conversation}
    {rightContent && <div className="dsh-right-column" ref={element => { if (element) element.inert = !rightPanel; }} aria-hidden={!rightPanel} style={!rightPanel ? { width: paintedOverlay ? Math.min(width - 72, rightWidth) : 0, overflow: 'hidden' } : undefined}>{rightPanel && !overlayRight && separator('right')}{rightContent}</div>}
  </div>;
}
