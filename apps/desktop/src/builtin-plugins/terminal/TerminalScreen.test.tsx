import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import TerminalScreen from './TerminalScreen';
import { terminalRequest } from './api';
const mocks=vi.hoisted(()=>({write:vi.fn(),dispose:vi.fn(),reset:vi.fn(),input:undefined as undefined|((s:string)=>void)}));
vi.mock('@xterm/xterm',()=>({Terminal:class{rows=24;cols=80;loadAddon(){}open(){}focus(){}reset=mocks.reset;dispose=mocks.dispose;onData(cb:(s:string)=>void){mocks.input=cb;return{dispose:vi.fn()};}write(data:Uint8Array,cb:()=>void){mocks.write(data);cb();}}}));
vi.mock('@xterm/addon-fit',()=>({FitAddon:class{fit(){}}}));
vi.mock('./api',()=>({terminalRequest:vi.fn()}));
const bridge=vi.mocked(terminalRequest);
const session={id:'pty_1',projectId:'a',cwd:'/a',pid:1,ended:false,exitCode:null};
beforeEach(()=>{bridge.mockReset();mocks.write.mockClear();mocks.dispose.mockClear();mocks.reset.mockClear();});
it('renders bounded byte pages, marks truncated history and reports real exit code',async()=>{
  bridge.mockResolvedValue({data:[228,184,173],nextAfter:100,truncated:true,ended:true,exitCode:7,hasMore:false});
  render(<TerminalScreen session={session}/>);
  await screen.findByText(/退出码 7/);
  expect(mocks.reset).toHaveBeenCalledTimes(1);expect(mocks.write.mock.calls[0][0]).toEqual(new Uint8Array([228,184,173]));
});
it('chunks typed Unicode input and ignores a late output page after unmount',async()=>{
  let resolve!:(v:unknown)=>void;
  bridge.mockImplementation(async action=>action==='read'?new Promise(done=>{resolve=done;}):{});
  const {unmount}=render(<TerminalScreen session={session}/>);
  await waitFor(()=>expect(bridge).toHaveBeenCalledWith('read',{projectId:'a',sessionId:'pty_1',after:0}));
  act(()=>mocks.input!('中'.repeat(1300)));
  await waitFor(()=>expect(bridge.mock.calls.filter(([a])=>a==='write')).toHaveLength(2));
  const parts=bridge.mock.calls.filter(([a])=>a==='write').map(([,p])=>String(p?.data));
  expect(parts.join('')).toBe('中'.repeat(1300));expect(parts.every(p=>new TextEncoder().encode(p).length<=4096)).toBe(true);
  unmount();await act(async()=>resolve({data:[65],nextAfter:1,truncated:false,ended:true,exitCode:0,hasMore:false}));
  expect(mocks.write).not.toHaveBeenCalled();expect(mocks.dispose).toHaveBeenCalled();
});
