import { useEffect, useState, type ReactNode } from 'react';
import { TextShimmer } from '../vendor/dsh/primitives/TextShimmer';
import chatCss from '../vendor/dsh/conversation/ChatView.module.css';
import { DisclosureRow } from '../vendor/dsh/primitives/DisclosureRow';
import TurnProcessToggle from '../vendor/dsh/conversation/TurnProcessToggle';
import bridge from '../vendor/dsh/conversation/MoosFlow.module.css';
import treeCss from '../vendor/dsh/conversation/ToolCallTree.module.css';
import rowCss from '../vendor/dsh/conversation/ToolRow.module.css';
import { IconCodeOutlineRegular, IconEditOutlineRegular, IconSearchOutlineRegular } from '../vendor/dsh/primitives/icons/index';
import { isActive, statusLabel, type AgentEvent, type Task } from '../types';
import { activities, activityLabel, changedFiles } from './activity';
import { TaskFiles } from './TaskTrajectory';
import MessageContent from './MessageContent';
import { projectTimeline } from './timeline';
import { useTaskTimeline } from './useTaskTimeline';

const toolIcon = (name: string) => ['write','edit'].includes(name) ? IconEditOutlineRegular : name === 'grep' ? IconSearchOutlineRegular : IconCodeOutlineRegular;

function toolTitle(events: AgentEvent[]) {
  const names = new Set(activities(events).map(row => row.name));
  const edits = names.has('write') || names.has('edit');
  if (edits && names.has('bash')) return '编辑了文件并运行了命令';
  if (edits) return '编辑了文件';
  if (names.has('bash')) return '运行了命令';
  if (names.has('grep')) return '搜索了内容';
  return [...names].every(name => ['read', 'ls', 'find'].includes(name)) ? '查看了文件与项目' : '使用了工具';
}

function ToolCard({ events, running }: { events: AgentEvent[]; running: boolean }) {
  const rows = activities(events);
  const active = running && rows.some(row => !row.done);
  const title = toolTitle(events);
  const confirmed = rows.every(row => row.done && !row.failed);
  const HeaderIcon = toolIcon(rows[0]?.name ?? '');
  const [open,setOpen] = useState(active);
  useEffect(()=>setOpen(active),[active]);
  return <DisclosureRow className={`${rowCss.root} dsh-tool-card`} icon={<HeaderIcon/>} title={confirmed ? title : title.replace(/了/g, '')}
    open={open} expandable expandOnRowClick running={active} collapsedContent={<span className={rowCss.summary}>{rows.map(row=>row.path||row.commandLabel||row.name).filter(Boolean).join(' · ')}</span>} onToggle={()=>setOpen(value=>!value)}>
    <div className={treeCss.subCalls}>{rows.map(row => {
      const Icon=toolIcon(row.name);
      return <div className={bridge.toolRow} key={row.id}><Icon/><span className={rowCss.title}>{activityLabel(row.name)}</span><span className={rowCss.sep} aria-hidden/><span className={rowCss.summary} title={row.path||row.commandLabel||undefined}>{row.commandLabel||row.path||''}</span><small className={bridge.toolState}>{row.failed?'失败':row.done?'已完成':running?'进行中':'结果未记录'}</small></div>;
    })}</div>
  </DisclosureRow>;
}

export function taskDuration(task: Task) {
  if (isActive(task) || !task.createdAt || !task.updatedAt) return undefined;
  const duration = Date.parse(task.updatedAt) - Date.parse(task.createdAt);
  if (!Number.isFinite(duration) || duration < 0) return undefined;
  const seconds = Math.floor(duration / 1000);
  return seconds >= 60 ? `用时 ${Math.floor(seconds / 60)}分${seconds % 60}秒` : `用时 ${seconds}秒`;
}

export default function TurnTimeline({ task, events: snapshotEvents, savedText, messageSlots, onStop, timelineMode = 'off' }: {
  task: Task; events: AgentEvent[]; savedText?: string; messageSlots?: ReactNode; onStop: () => void; timelineMode?: 'off' | 'auto' | 'manual';
}) {
  const timeline = useTaskTimeline(task, snapshotEvents, timelineMode === 'auto');
  const events = timeline.events;
  const running = isActive(task);
  const [open,setOpen] = useState(running);
  useEffect(()=>setOpen(running),[running,task.id]);
  const { progress, reply } = projectTimeline(events, savedText, !running && (savedText !== undefined || ['succeeded', 'completed'].includes(task.status)));
  const count = activities(events).length;
  const duration = taskDuration(task);
  const status = statusLabel(task.status);
  const label = ['completed', 'succeeded'].includes(task.status) ? duration ?? status : `${status}${duration ? ` · ${duration}` : ''}`;
  const hasWork = progress.length > 0 || !!task.error || !!task.errorCode || running || timeline.busy || !!timeline.error || timeline.hasMore || (timelineMode !== 'off' && !timeline.loaded);
  const work = <>
    {progress.map(step => step.kind === 'text'
      ? step.text.trim() && <div className={`${bridge.narration} dsh-narration`} data-scroll-anchor key={step.id}><MessageContent text={step.text} /></div>
      : <ToolCard key={step.id} events={step.events} running={running} />)}
    {running && progress.length === 0 && <p className="turn-empty-reply">正在处理你的任务…</p>}
    {timeline.busy && <p className="timeline-load-note" role="status">正在加载完整过程…</p>}
    {timeline.error && <p className="timeline-load-note">{timeline.error} <button onClick={timeline.load}>重试</button></p>}
    {timeline.hasMore && !timeline.busy && <button className="timeline-load-more" data-preserve-scroll onClick={timeline.load}>继续加载过程</button>}
    {timeline.limited && <p className="timeline-load-note">过程较长，当前只展开部分记录；回复以已保存内容为准。</p>}
    {(task.error || task.errorCode) && <div className="process-error"><strong>错误详情</strong>{task.error && <p>{task.error}</p>}{task.errorCode && <p>错误码：{task.errorCode}</p>}</div>}
    {count > 0 && events.some(event => event.payload.toolName === 'bash' || event.payload.name === 'bash') && <p className="activity-note">文件清单不含命令产生的改动。</p>}
  </>;
  return <>
    <section className="dsh-turn-work" aria-label="实际工具轨迹" data-state={task.status}>
      <div className={bridge.processHead}>
        {running?<div className={chatCss.running} data-chat-running><span className={chatCss.runningContent}><IconCodeOutlineRegular/><TextShimmer active className={chatCss.runningText}><span role="status">{label}</span></TextShimmer></span></div>:<TurnProcessToggle label={label} open={open} hasContent={hasWork} failed={task.status==='failed'} onToggle={()=>{if(!open && timelineMode!=='off')timeline.load();setOpen(value=>!value);}} />}
        {running&&<button className={bridge.stop} aria-label="停止此任务" onClick={onStop}>停止</button>}
      </div>
      <div className={bridge.processBody} hidden={!open}>{work}</div>
    </section>
    {(reply?.trim() || (!running && changedFiles(events).length > 0)) && <section className="dsh-response" aria-label="本轮结果" data-scroll-anchor>
      {reply?.trim() && <MessageContent text={reply} />}
      <TaskFiles events={events} finished={!running} />
      {(timeline.limited || timeline.hasMore) && changedFiles(events).length > 0 && <p className="activity-note">文件清单仅包含当前已加载并确认的修改。</p>}
    </section>}
    {messageSlots}
  </>;
}
