/** Adapted directly from DeepSeek SettingsRoot.tsx SettingsPanel, MIT.
 * Copyright (c) 2026 DeepSeek. Upstream fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159.
 * Moos bridge replaces injected renderSlot only; original four-seat DOM/CSS is retained. */
import { useId, useLayoutEffect, useRef, type ReactNode, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useModalLayer } from '../primitives/ModalLayer/ModalLayer';
import css from './SettingsRoot.module.css';
import bridge from './SettingsBridge.module.css';
export interface SettingsRow { id:string; label:string; icon:ReactNode; }
export default function SettingsPanel({ rows, activeId, onSelect, onClose, renderContent }: {
  rows:readonly SettingsRow[]; activeId:string; onSelect:(id:string)=>void; onClose:()=>void;
  renderContent:(id:string)=>ReactNode;
}) {
  const active = rows.find(row => row.id === activeId)?.id ?? rows[0]?.id;
  const titleId = useId();
  const invoker = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const panel = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  useModalLayer(panel, true, onClose);
  // Native bridge: isolate product content while allowing Ant's portalled form
  // menus/modals to remain peers in document.body, with their own modal ownership.
  useLayoutEffect(() => {
    const roots = [...document.body.children].filter(node => node !== overlay.current && node.id === 'root') as HTMLElement[];
    const previous = roots.map(node => node.inert);
    roots.forEach(node => { node.inert = true; });
    return () => {
      roots.forEach((node,index) => { node.inert = previous[index]; });
      const target = invoker.current;
      // Original modal hook restores before this bridge removes root inert.
      // Repeat only that same restoration after the native inert lifetime ends.
      if (target?.isConnected && !target.closest('[inert], [hidden]')) target.focus({preventScroll:true});
    };
  }, []);
  const navigate = (event:KeyboardEvent<HTMLElement>) => {
    const index = rows.findIndex(row => row.id === active);
    const next = ['ArrowDown','ArrowRight'].includes(event.key) ? (index + 1) % rows.length
      : ['ArrowUp','ArrowLeft'].includes(event.key) ? (index + rows.length - 1) % rows.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : -1;
    if (next < 0 || !rows.length) return;
    event.preventDefault(); onSelect(rows[next].id);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };
  return createPortal(<div ref={overlay} className={css.overlay} role="presentation" data-dsh-source-settings>
    <div className={css.mask} aria-hidden="true" onClick={onClose} data-testid="settings-mask" />
    <div ref={panel} tabIndex={-1} data-shortcut-modal="settings" className={css.panel} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className={css.navTitle} id={titleId} tabIndex={-1}>设置中心</div>
      <nav className={css.nav} role="tablist" aria-label="设置分区" aria-orientation="vertical" onKeyDown={navigate}>
        <div className={css.navList}>{rows.map(row => <button key={row.id} type="button" id={`settings-tab-${row.id}`} role="tab"
          className={[css.navCell,row.id===active ? css.active : ''].join(' ')} aria-current={row.id===active ? 'true' : undefined}
          aria-selected={row.id===active} tabIndex={row.id===active ? 0 : -1} aria-controls="settings-panel"
          data-modal-autofocus={row.id===active ? '' : undefined}
          onFocus={event => event.currentTarget.scrollIntoView?.({block:'nearest',inline:'nearest'})} onClick={() => onSelect(row.id)}>
          <span className={css.navIcon} aria-hidden="true">{row.icon}</span><span className={css.navLabel}>{row.label}</span>
        </button>)}</div>
      </nav>
      <div className={css.header}><div className={css.actions} /><button type="button" className={css.close} onClick={onClose} aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="m2 2 10 10M12 2 2 12" stroke="currentColor" fill="none" /></svg><span className={css.hiddenLabel}>关闭</span>
      </button></div>
      <div key={active} className={`${css.options} ${bridge.options}`} id="settings-panel" role="tabpanel" tabIndex={0} aria-labelledby={`settings-tab-${active}`}>{active && renderContent(active)}</div>
    </div>
  </div>,document.body);
}
