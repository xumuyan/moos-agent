/** Presentation port of DeepSeek Harness InputBar/DraftEditor/EmptyHero.
 * Copyright (c) 2026 DeepSeek. MIT; see SOURCE.md and THIRD_PARTY_NOTICES.md.
 * Host adaptation: controlled textarea instead of the upstream Lexical machine;
 * actual Moos actions arrive as props. No attachment/plan/queue capability stubs.
 */
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { IconFolderOpenRegular } from '../primitives/icons';
import css from './InputBar.module.css';
import heroCss from './HeroShell.module.css';
import rootCss from './ConversationRoot.module.css';
import bridge from './MoosBridge.module.css';

export interface DshComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  busy?: boolean;
  running?: boolean;
  onStop?: () => void;
  hero?: boolean;
  placeholder?: string;
  leading?: ReactNode;
  permission?: ReactNode;
  model?: ReactNode;
  readings?: ReactNode;
  trailing?: ReactNode;
  workspaceName?: string;
  title?: string;
  icon?: ReactNode;
}

export default function DshComposer({value,onChange,onSubmit,disabled=false,busy=false,running=false,onStop,hero=false,
  placeholder='描述开发任务，Enter 发送，Shift + Enter 换行',leading,permission,model,readings,trailing,workspaceName,
  title='今天想完成什么？',icon}:DshComposerProps) {
  const input = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const locked = disabled || busy || running;
  useLayoutEffect(() => {
    const element=input.current;
    if (!element) return;
    element.style.height='auto';
    element.style.height=`${Math.max(hero?52:36,element.scrollHeight)}px`;
  },[value,hero]);
  const submit = () => { if (!locked && value.trim()) onSubmit(); };
  const bar = <div key="composer-bar" className={`${css.root} ${hero?css.hero:''}`}>
    <div className={css.card} tabIndex={-1} data-composer-card>
      <div id="moos-composer-addon-panel" className={`${css.accessory} ${bridge.addonPanel}`} />
      <div className={css.scroll} data-input-scroll>
        <div className={css.grow}>
          <textarea ref={input} rows={1} className={`${css.input} ${bridge.textarea}`} aria-label="任务内容" value={value}
            disabled={locked} placeholder={placeholder} onChange={event=>onChange(event.target.value)}
            onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}}
            onKeyDown={event=>{if(event.key==='Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !composing.current && event.keyCode!==229){event.preventDefault();submit();}}} />
        </div>
      </div>
      <div className={css.row}>
        <div className={css.tools}>{leading}<div className={css.modes}>{permission}</div></div>
        <div className={css.trailing}>
          <div className={css.standardControls}>{model}</div>
          <button type="button" className={css.primary} aria-label={running?'停止任务':'发送任务'} aria-busy={busy}
            data-sending={busy?'':undefined} disabled={running?!onStop:locked||!value.trim()}
            onMouseDown={event=>event.preventDefault()} onClick={running?onStop:submit}>
            {running?<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden><rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" /></svg>
              :busy?<svg className={css.sendingSpinner} viewBox="0 0 16 16" width="16" height="16" aria-hidden><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="2"/><path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
              :<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden><path d="M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z" fill="currentColor"/></svg>}
          </button>
        </div>
      </div>
    </div>
    <div className={css.dock} data-composer-dock>{readings}</div>
    {trailing}
  </div>;
  return <footer className={`${rootCss.composerStack} composer-dock ${hero ? rootCss.composerHero : ''}`} aria-label="任务输入区">
    {/* ConversationContent keeps the headline, workspace row and input bar as siblings. */}
    <div hidden={!hero} className={hero ? heroCss.root : undefined}>
      <div className={heroCss.stack}>
        <div className={heroCss.headline} role="heading" aria-level={2}>
          {icon && <span className={heroCss.fishHitbox}>{icon}</span>}
          <span className={heroCss.titleGroup}><span>{title}</span></span>
        </div>
        <div className={heroCss.body} />
      </div>
    </div>
    <div hidden={!hero || !workspaceName} className={hero && workspaceName ? rootCss.heroWorkspaceRow : undefined}>
      <span className={`${heroCss.workspace} ${bridge.workspaceReadout}`}>
        <IconFolderOpenRegular className={heroCss.folder} size={16} />
        <span className={heroCss.workspaceLabel}>{workspaceName}</span>
      </span>
    </div>
    {bar}
  </footer>;
}
