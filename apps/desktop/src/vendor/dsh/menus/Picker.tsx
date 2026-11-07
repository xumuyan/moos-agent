/** Menu/ModelSelect/PermissionSelect presentation adapted from DeepSeek Harness,
 * copyright (c) 2026 DeepSeek, MIT. See SOURCE.md. Host hooks are replaced by props. */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconCheckOutlineRegular, IconChevronDownOutlineRegular } from '../primitives/icons';
import menu from './Menu.module.css';
import surface from './MenuSurface.module.css';
import modelCss from './ModelSelect.module.css';
import permissionCss from './PermissionSelect.module.css';
import bridge from './MoosMenuBridge.module.css';
import { PermissionIconReadOnlyRegular, PermissionIconAutoReviewRegular, PermissionIconFullAccessRegular } from './PermissionIcon';

interface Item {id:string; label:string; description?:string; icon?:ReactNode;}
function Picker({items,value,onChange,disabled,label,model=false,title}:{items:Item[];value:string;onChange:(id:string)=>void;disabled?:boolean;label:string;model?:boolean;title?:string}) {
 const css=model?modelCss:permissionCss;
 const [phase,setPhase]=useState<'enter'|'open'|'dismiss'>();
 const [position,setPosition]=useState({left:12,top:12});
 const trigger=useRef<HTMLButtonElement>(null), popup=useRef<HTMLDivElement>(null), restore=useRef(false);
 const selected=items.find(item=>item.id===value);
 useEffect(()=>{if(disabled&&phase)setPhase('dismiss');},[disabled,phase]);
 const close=(focus=true)=>{restore.current=focus;setPhase('dismiss');};
 useEffect(()=>{if(phase!=='enter'&&phase!=='dismiss')return;const id=window.setTimeout(()=>{
   if(phase==='enter')setPhase('open');else{setPhase(undefined);if(restore.current)trigger.current?.focus();}
 },window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?0:phase==='enter'?40:80);return()=>clearTimeout(id);},[phase]);
 useLayoutEffect(()=>{if(!phase||phase==='dismiss')return;
   const place=()=>{const r=trigger.current?.getBoundingClientRect(),p=popup.current?.getBoundingClientRect();if(!r||!p)return;
    setPosition({left:Math.max(12,Math.min(r.left,window.innerWidth-p.width-12)),top:r.bottom+4+p.height<=window.innerHeight-12?r.bottom+4:Math.max(12,r.top-p.height-4)});};place();window.addEventListener('resize',place);return()=>window.removeEventListener('resize',place);
 },[phase]);
 useEffect(()=>{if(!phase||phase==='dismiss')return;
   const outside=(e:PointerEvent)=>{if(!popup.current?.contains(e.target as Node)&&!trigger.current?.contains(e.target as Node))close(false);};
   const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();close();}};
   document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
 },[phase]);
 const open=()=>{if(disabled)return;setPhase('enter');};
 useLayoutEffect(()=>{if(phase==='enter')(popup.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')??popup.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]'))?.focus();},[phase]);
 return <div className={model?modelCss.root:menu.root}>
  <button ref={trigger} type="button" className={css.trigger} role={model?'combobox':undefined} aria-label={label} aria-haspopup="menu" aria-expanded={!!phase&&phase!=='dismiss'} disabled={disabled} title={title}
   onClick={()=>phase&&phase!=='dismiss'?close():open()} onKeyDown={e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();open();}}}>
   {!model&&selected?.icon&&<span className={permissionCss.triggerIcon} aria-hidden>{selected.icon}</span>}
   <span className={css.triggerLabel}>{selected?.label??'选择模型服务'}</span>
   {!model&&<span className={permissionCss.badge}>计划中</span>}
   <span className={`${css.chevron} ${phase&&phase!=='dismiss'?css.chevronOpen:''}`} aria-hidden><IconChevronDownOutlineRegular size={12}/></span>
  </button>
  {phase&&createPortal(<div ref={popup} className={`${menu.list} ${menu.portal} ${surface.surface} ${bridge.popup}`} style={{left:position.left,top:position.top,right:'auto',bottom:'auto'}} role="menu" aria-label={label} data-menu-phase={phase==='open'?undefined:phase}
    onKeyDown={e=>{const rows=Array.from(popup.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')??[]),index=rows.indexOf(document.activeElement as HTMLButtonElement);const next=e.key==='ArrowDown'?(index+1)%rows.length:e.key==='ArrowUp'?(index+rows.length-1)%rows.length:e.key==='Home'?0:e.key==='End'?rows.length-1:-1;if(next>=0){e.preventDefault();rows[next]?.focus();}if(e.key==='Tab')close(false);}}
    aria-hidden={phase==='dismiss'}>
   <div className={surface.material} aria-hidden/>
   <div className={menu.viewport} role="presentation">{items.map(item=><div key={item.id} className={menu.itemWrap}>
    <button type="button" className={`${model?modelCss.option:menu.item} ${item.id===value?menu.selected:''}`} role="menuitemradio" aria-checked={item.id===value} disabled={disabled||phase==='dismiss'}
     onClick={()=>{onChange(item.id);close();}}>
     {item.icon&&<span className={menu.itemIcon} aria-hidden>{item.icon}</span>}
     <span className={model?modelCss.optionCopy:menu.itemLabel}><span className={model?modelCss.modelName:permissionCss.optionLabelText}>{item.label}</span>{item.description&&<span className={bridge.description}>{item.description}</span>}</span>
     {item.id===value&&<IconCheckOutlineRegular className={menu.check} size={14}/>}</button></div>)}</div>
  </div>,document.body)}
 </div>;
}
export function DshModelPicker({items,value,onChange,disabled}:{items:{id:string;name:string;model:string}[];value:string;onChange:(id:string)=>void;disabled?:boolean}) {
 return <Picker model items={items.map(item=>({id:item.id,label:`${item.name} · ${item.model}`}))} {...{value,onChange,disabled}} label="选择模型"/>;
}
const modes:Item[]=[{id:'ask',label:'请求批准',description:'编辑外部文件或使用互联网时始终询问',icon:<PermissionIconReadOnlyRegular/>},{id:'assist',label:'帮我批准',description:'仅对检测到风险的操作请求批准',icon:<PermissionIconAutoReviewRegular/>},{id:'full',label:'完全访问权限',description:'不增加任务内确认，但系统权限仍由 macOS 控制',icon:<PermissionIconFullAccessRegular/>}];
export function DshPermissionMenu(){const [value,setValue]=useState(()=>{const saved=localStorage.getItem('moos.permission-mode');return modes.some(m=>m.id===saved)?saved!:'assist';});
 return <Picker items={modes} value={value} onChange={next=>{localStorage.setItem('moos.permission-mode',next);setValue(next);}} label={`权限模式：${modes.find(m=>m.id===value)!.label}`} title="执行策略后端接入计划中；此选择不能绕过 macOS 权限。"/>;}
