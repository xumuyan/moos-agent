import { beforeEach, expect, it, vi } from 'vitest';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { terminalRequest } from './api';
vi.mock('@tauri-apps/api/core',()=>({invoke:vi.fn(),isTauri:vi.fn()}));
beforeEach(()=>{vi.mocked(invoke).mockReset();vi.mocked(isTauri).mockReturnValue(true);});
it('uses dedicated native commands, serializes calls, and releases after rejection',async()=>{
  let finish!:(v:unknown)=>void;vi.mocked(invoke).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockRejectedValueOnce('native failure').mockResolvedValueOnce({ok:true});
  const first=terminalRequest('list',{projectId:'a'});const next=terminalRequest('open',{projectId:'b'});const failed=next.catch(()=>{});const third=terminalRequest('close_all');
  await vi.waitFor(()=>expect(invoke).toHaveBeenCalledTimes(1));finish([]);await first;await failed;await third;
  expect(invoke).toHaveBeenNthCalledWith(1,'terminal_request',{action:'list',params:{projectId:'a'}});
  expect(invoke).toHaveBeenNthCalledWith(3,'terminal_request',{action:'close_all',params:{}});
});
it('has no browser HTTP shell fallback',async()=>{vi.mocked(isTauri).mockReturnValue(false);await expect(terminalRequest('open',{projectId:'a'})).rejects.toThrow('Mac');expect(invoke).not.toHaveBeenCalled();});
