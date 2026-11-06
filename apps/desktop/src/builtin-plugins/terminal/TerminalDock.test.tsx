import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import TerminalDock from './TerminalDock';
import { terminalRequest } from './api';
vi.mock('./api',()=>({nativeTerminalAvailable:()=>true,terminalRequest:vi.fn()}));
vi.mock('./TerminalScreen',()=>({default:({session}:{session:{id:string}})=><div>SCREEN:{session.id}</div>}));
const bridge=vi.mocked(terminalRequest);
beforeEach(()=>bridge.mockReset());
it('creates project-owned tabs, hides without closing, and closes explicitly',async()=>{
  const tabs:{id:string;projectId:string}[]=[];
  bridge.mockImplementation(async(action,params)=>{
    if(action==='list')return [...tabs];
    if(action==='open'){const s={id:'pty_1_0',projectId:String(params?.projectId)};tabs.push(s);return s;}
    if(action==='close'){tabs.splice(0);return {};}
    return {};
  });
  const user=userEvent.setup();render(<TerminalDock projectId="a"/>);
  await user.click(screen.getByRole('button',{name:'打开内置终端'}));
  await user.click(screen.getByRole('button',{name:'新建终端'}));
  await screen.findByText('SCREEN:pty_1_0');
  expect(screen.getByText('运行中的标签占用项目锁，退出后自动释放')).toBeVisible();
  expect(bridge).toHaveBeenCalledWith('open',{projectId:'a'});
  await user.click(screen.getByRole('button',{name:'收起内置终端'}));
  expect(bridge.mock.calls.some(([a])=>a==='close')).toBe(false);
  await user.click(screen.getByRole('button',{name:'打开内置终端'}));
  await user.click(screen.getByRole('button',{name:'中断 Ctrl+C'}));
  expect(bridge).toHaveBeenCalledWith('interrupt',{projectId:'a',sessionId:'pty_1_0'});
  await user.click(screen.getByRole('button',{name:'关闭终端 0'}));
  await waitFor(()=>expect(screen.queryByText('SCREEN:pty_1_0')).not.toBeInTheDocument());
});
it('does not apply a late open response to another project',async()=>{
  let resolve!:(v:unknown)=>void;
  bridge.mockImplementation(async action=>action==='open'?new Promise(done=>{resolve=done;}):[]);
  const user=userEvent.setup();const {rerender}=render(<TerminalDock projectId="a"/>);
  await user.click(screen.getByRole('button',{name:'打开内置终端'}));await user.click(screen.getByRole('button',{name:'新建终端'}));
  rerender(<TerminalDock projectId="b"/>);
  await act(async()=>resolve({id:'a-late',projectId:'a'}));
  expect(screen.queryByText('SCREEN:a-late')).not.toBeInTheDocument();
  expect(bridge.mock.calls.filter(([a,p])=>a==='open'&&p?.projectId==='b')).toHaveLength(0);
});
it('shows a bounded native workspace lock error and permits retry',async()=>{
  bridge.mockImplementation(async action=>{if(action==='open')throw '项目正被任务占用';return [];});
  const user=userEvent.setup();render(<TerminalDock projectId="a"/>);
  await user.click(screen.getByRole('button',{name:'打开内置终端'}));await user.click(screen.getByRole('button',{name:'新建终端'}));
  await screen.findByText('项目正被任务占用');
  expect(screen.getByRole('button',{name:'新建终端'})).toBeEnabled();
});
