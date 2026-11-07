/** TurnProcessNodeView display extraction, Copyright(c)2026 DeepSeek, MIT.
 * Moos projects its truthful task label; no upstream domain or fabricated turns. */
import { IconChevronDownOutlineRegular } from '../primitives/icons/index';
import css from './TurnProcessNodeView.module.css';
export default function TurnProcessToggle({label,open,hasContent,onToggle,failed=false}:{label:string;open:boolean;hasContent:boolean;onToggle:()=>void;failed?:boolean}) {
 return <button type="button" className={css.root} data-open={open||undefined} disabled={!hasContent} aria-expanded={hasContent?open:undefined}
  data-scroll-anchor data-preserve-scroll onClick={event=>{event.currentTarget.focus();onToggle();}}>
  <span className={css.label} role={failed?'alert':'status'}>{label}</span>
  {hasContent&&<IconChevronDownOutlineRegular className={css.chevron}/>}
 </button>;
}
