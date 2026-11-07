/** Frame column JSX/CSS extracted from DeepSeek Harness AppFrame (MIT, fcc0ad4).
 * Moos retains its width/permission state adapter and command-free resize handlers.
 * Full provenance: vendor/dsh/sidebar/source-map.json and THIRD_PARTY_NOTICES.md. */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { RightPanelFrame } from '../vendor/dsh/rightpanel/RightPanelFrame';
import { IconNewChatOutlineRegular, IconPanelLeftOutlineRegular } from '../vendor/dsh/primitives/icons/index';
import leading from '../vendor/dsh/sidebar/HeaderLeadingControls.module.css';
import frame from '../vendor/dsh/layout/AppFrame.module.css';
import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import { clampWidth, computeColumns, SIDEBAR_DEFAULT, SIDEBAR_MIN, SIDEBAR_MAX, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_COLLAPSED, SIDEBAR_DRAWER_BREAKPOINT, RIGHTBAR_MIN, RIGHTBAR_DEFAULT_RATIO, RIGHTBAR_MAX_RATIO } from './dsh-columns';

export default function AppShell({ rail, sidebar, conversation, rightPanel, preferredRightWidth, navigation, onNewConversation, newConversationDisabled }: {
  rail?: ReactNode; sidebar: ReactNode; conversation: ReactNode; rightPanel?: ReactNode; preferredRightWidth?: number; navigation?: (state: { wide:boolean; fading:boolean; railEntering:boolean; toggle:()=>void }) => ReactNode;
  onNewConversation?: () => void; newConversationDisabled?: boolean;
}) {
  const [width, setWidth] = useState(() => window.innerWidth);
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < SIDEBAR_AUTO_COLLAPSE);
  const [navigationAnimated, setNavigationAnimated] = useState(false);
  useEffect(() => { if (!navigationAnimated) return; const timer=window.setTimeout(()=>setNavigationAnimated(false),300); return ()=>window.clearTimeout(timer); },[navigationAnimated,collapsed]);
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
  const darwin = document.documentElement.dataset.platform === 'darwin';
  const drawer = width < SIDEBAR_DRAWER_BREAKPOINT;
  const drawerOpen = drawer && !collapsed;
  const rightOpen = Boolean(rightPanel);
  const columns = computeColumns(width, collapsed || drawer ? 0 : sidebarWidth,
    rightOpen ? rightWidth : 0, darwin || drawer ? 0 : SIDEBAR_COLLAPSED);
  const overlayRight = rightOpen && columns.rightbar === 0;
  const panelWidth = overlayRight ? Math.max(0, Math.min(width - 72, rightWidth)) : columns.rightbar;
  const lastPanelWidth = useRef(panelWidth);
  useLayoutEffect(() => { if (rightOpen) lastPanelWidth.current = panelWidth; }, [rightOpen, panelWidth]);
  const [rightAnimated, setRightAnimated] = useState(false);
  const previousRightOpen = useRef(rightOpen);
  useLayoutEffect(() => {
    const changed = previousRightOpen.current !== rightOpen;
    previousRightOpen.current = rightOpen;
    if (reducedMotion) { setRightAnimated(false); return; }
    if (!changed) return;
    setRightAnimated(true);
    const timer = window.setTimeout(() => setRightAnimated(false), 300);
    return () => window.clearTimeout(timer);
  }, [rightOpen, reducedMotion]);
  const separator = (side: 'sidebar' | 'right') => <div role="separator" tabIndex={0} aria-label={side === 'sidebar' ? '调整侧栏宽度' : '调整工具面板宽度'} aria-orientation="vertical" aria-valuemin={side === 'sidebar' ? SIDEBAR_MIN : RIGHTBAR_MIN} aria-valuemax={side === 'sidebar' ? SIDEBAR_MAX : Math.max(RIGHTBAR_MIN, width * RIGHTBAR_MAX_RATIO)} aria-valuenow={Math.round(side === 'sidebar' ? sidebarWidth : rightWidth)}
    className={frame.handle} data-side={side === 'right' ? 'rightbar' : side} style={{ left: side === 'sidebar' ? columns.sidebar : width - columns.rightbar }}
    onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); drag.current = { side, start: event.clientX, width: side === 'sidebar' ? sidebarWidth : rightWidth }; }}
    onPointerMove={event => { const current = drag.current; if (!current || current.side !== side) return; const delta = event.clientX - current.start; if (side === 'sidebar') setSidebarWidth(clampWidth(current.width + delta, SIDEBAR_MIN, SIDEBAR_MAX)); else setRightWidth(clampWidth(current.width - delta, RIGHTBAR_MIN, Math.max(RIGHTBAR_MIN, width * RIGHTBAR_MAX_RATIO))); }}
    onPointerUp={() => { drag.current = undefined; setDragging(false); }} onPointerCancel={() => { drag.current = undefined; setDragging(false); }} onLostPointerCapture={() => { drag.current = undefined; setDragging(false); }}
    onDoubleClick={() => side === 'sidebar' ? setSidebarWidth(SIDEBAR_DEFAULT) : setRightWidth(Math.max(RIGHTBAR_MIN, width * RIGHTBAR_DEFAULT_RATIO))}
    onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return; event.preventDefault(); const step = event.key === 'ArrowLeft' ? -16 : 16; if (side === 'sidebar') setSidebarWidth(event.key === 'Home' ? SIDEBAR_DEFAULT : clampWidth(sidebarWidth + step, SIDEBAR_MIN, SIDEBAR_MAX)); else setRightWidth(event.key === 'Home' ? Math.max(RIGHTBAR_MIN, width * RIGHTBAR_DEFAULT_RATIO) : clampWidth(rightWidth - step, RIGHTBAR_MIN, Math.max(RIGHTBAR_MIN, width * RIGHTBAR_MAX_RATIO))); }} />;
  const toggle = () => {
    setNavigationAnimated(true);
    setCollapsed(value => !value);
  };
  const sidebarHidden = collapsed && (darwin || drawer);
  const navigationWidth = railLayout && !sidebarHidden ? SIDEBAR_COLLAPSED : sidebarWidth;
  return <div
    className={`${frame.frame} app-shell ${railLayout ? 'is-rail-layout' : ''} ${collapsed && !railLayout ? 'is-sidebar-fading' : ''} ${drawerOpen ? 'has-overlay-sidebar' : ''}`}
    data-animating={!reducedMotion && (navigationAnimated || rightAnimated) ? '' : undefined}
    data-dragging={dragging ? '' : undefined}
    data-sidebar-collapsed={collapsed ? '' : undefined}
    data-sidebar-drawer={drawer ? '' : undefined}
    data-rightbar-collapsed={columns.rightbar === 0 ? '' : undefined}
    style={{
      height: '100dvh',
      gridTemplateColumns: `${columns.sidebar}px minmax(0,1fr) ${columns.rightbar}px`,
      '--dsh-conversation-column-width': `${columns.center}px`,
    } as CSSProperties}
  >
    {drawerOpen && <button type="button" className={frame.drawerMask} style={{border:0}} aria-label="关闭侧栏覆盖层" onClick={toggle} />}
    <div className={frame.sidebarCol} inert={sidebarHidden} aria-hidden={sidebarHidden || undefined} style={{width:drawer ? Math.min(sidebarWidth,width-56) : undefined}}>
      {navigation ? <div style={{width:navigationWidth,height:'100%'}}>
        {navigation({wide:!railLayout,fading:collapsed&&!railLayout,railEntering:navigationAnimated&&railLayout,toggle})}
      </div> : <>
        <button aria-label={collapsed?'展开侧栏':'收起侧栏'} aria-expanded={!collapsed} onClick={toggle}>{collapsed?<MenuUnfoldOutlined/>:<MenuFoldOutlined/>}</button>
        {rail}<div inert={collapsed} aria-hidden={collapsed} hidden={railLayout} style={{width:sidebarWidth}}>{sidebar}</div>
      </>}
    </div>
    <div className={frame.centerCol} inert={drawerOpen}><div className={frame.mainPanel}>{conversation}</div></div>
    <div className={frame.rightbarCol} data-rightbar-col aria-hidden={!rightOpen} inert={drawerOpen || !rightOpen}>
      {rightContent && <RightPanelFrame.Provider value={{width:rightOpen ? panelWidth : lastPanelWidth.current,open:rightOpen}}>
        {rightContent}
      </RightPanelFrame.Provider>}
    </div>
    {sidebarHidden && <div className={frame.leadingSeat} data-shell-leading>
      <div className={leading.controls}>
        <button type="button" data-sidebar-opener className={leading.iconButton} aria-label="展开侧栏" aria-expanded={false} onClick={toggle}><IconPanelLeftOutlineRegular size={16}/></button>
        {onNewConversation && <button type="button" className={leading.iconButton} aria-label="新建会话" disabled={newConversationDisabled} onClick={onNewConversation}><IconNewChatOutlineRegular size={16}/></button>}
      </div>
    </div>}
    {!collapsed&&!drawer&&separator('sidebar')}{rightOpen&&!overlayRight&&separator('right')}
  </div>;
}
