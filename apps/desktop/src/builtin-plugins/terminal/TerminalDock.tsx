import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Button, Tooltip } from 'antd';
import { CloseOutlined, CodeOutlined, PlusOutlined } from '@ant-design/icons';
import { nativeTerminalAvailable, terminalRequest, type TerminalSession } from './api';
import './terminal.css';
const TerminalScreen = lazy(() => import('./TerminalScreen'));
export default function TerminalDock({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false), [sessions, setSessions] = useState<TerminalSession[]>([]), [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const available = nativeTerminalAvailable();
  const owner = useRef(projectId); owner.current = projectId;
  useEffect(() => {
    let stale = false; setSessions([]); setSelected(''); setError(''); setBusy(false);
    if (available && projectId) void terminalRequest<TerminalSession[]>('list', { projectId }).then(list => { if (!stale) {setSessions(list);setSelected(list[0]?.id ?? '');} }).catch(() => {if (!stale) setError('无法读取终端列表');});
    return () => { stale = true; };
  }, [available, projectId]);
  const refresh = async () => { const list = await terminalRequest<TerminalSession[]>('list', { projectId }); if (owner.current !== projectId) return; setSessions(list);setSelected(current => list.some(s => s.id === current) ? current : list[0]?.id ?? ''); };
  const create = async () => {
    if (busy || !projectId || !available) return;
    setBusy(true);setError('');
    try { const item = await terminalRequest<TerminalSession>('open', { projectId }); await refresh();if (owner.current === projectId) {setSelected(item.id);setOpen(true);} }
    catch (error) {if (owner.current === projectId) setError(typeof error === 'string' ? error : '无法打开终端，请确认项目没有正在执行或排队的任务。');}
    finally {if (owner.current === projectId) setBusy(false);}
  };
  const close = async (id: string) => {setBusy(true);setError(''); try {await terminalRequest('close',{projectId,sessionId:id});await refresh();}catch {setError('终端尚未关闭，请重试；目录锁未提前释放。');}finally {setBusy(false);} };
  const current = sessions.find(s => s.id === selected);
  return <div className="terminal-plugin">
    <div className="terminal-toolbar"><Button type="text" size="small" icon={<CodeOutlined />} aria-label={open ? '收起内置终端' : '打开内置终端'} disabled={!available || !projectId} onClick={() => {setOpen(value => !value);}}>{open ? '收起终端' : '终端'}{sessions.length ? ` · ${sessions.length}` : ''}</Button><span>{!available ? 'Mac 桌面可用' : sessions.length ? '运行中的标签占用项目锁，退出后自动释放' : ''}</span></div>
    {open && <section className="terminal-dock" aria-label="项目终端"><div className="terminal-tabs" role="tablist" aria-label="终端标签">{sessions.map(session => <div className="terminal-tab" key={session.id}><Button type={selected === session.id ? 'primary' : 'text'} size="small" role="tab" aria-selected={selected === session.id} onClick={() => setSelected(session.id)}>终端 {session.id.split('_').at(-1)}</Button><Tooltip title="关闭此终端及其命令"><Button type="text" size="small" icon={<CloseOutlined />} aria-label={`关闭终端 ${session.id.split('_').at(-1)}`} disabled={busy} onClick={() => void close(session.id)} /></Tooltip></div>)}<Button type="text" size="small" icon={<PlusOutlined />} aria-label="新建终端" disabled={busy || sessions.length >= 4} onClick={() => void create()} />{current && <Button type="text" size="small" className="terminal-interrupt" disabled={busy} onClick={() => void terminalRequest('interrupt',{projectId,sessionId:current.id}).catch(() => setError('进程已退出或暂时无法中断，请关闭标签。'))}>中断 Ctrl+C</Button>}</div>
      {current ? <Suspense fallback={<p className="terminal-empty">正在加载终端…</p>}><TerminalScreen key={current.id} session={current} /></Suspense> : <div className="terminal-empty"><p>在当前项目目录中打开 shell。</p><Button disabled={busy} onClick={() => void create()}>开始终端</Button></div>}
      <p className="terminal-footnote">收起后命令继续。目录锁覆盖所选项目；Shell 可访问当前账户有权限的其他目录。退出应用会关闭终端，不自动重放命令。</p>
    </section>}{error && <p role="alert" className="terminal-error">{error}</p>}
  </div>;
}
