import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import App from './App';
import { request } from './api';
vi.mock('./api',()=>({request:vi.fn()}));
const base={projects:[{id:'p',name:'项目',path:'/work'}],conversations:[{id:'c',projectId:'p',title:'对话'}],providers:[{id:'m',name:'模型',model:'fixture',api:'openai-completions',hasKey:true}],messages:[],tasks:[],events:[]};
test('keeps a scoped-history error reachable instead of covering it with the new hero',async()=>{
 const empty={total:0,hasMore:false,before:null,requiresScopedPage:true,truncatedRows:[]};
 vi.mocked(request).mockImplementation(async(method,params={})=>{
  if(method==='snapshot'&&params.conversationId)throw new Error('scoped history fixture failed');
  if(method==='snapshot')return {...base,history:{pages:[{conversationId:'c',messages:empty,tasks:empty,events:empty}]}};
  return {};
 });
 render(<App/>);
 expect(await screen.findByText('scoped history fixture failed')).toBeInTheDocument();
 expect(screen.queryByRole('heading',{name:'今天想完成什么？'})).toBeNull();
});
test('offers actual model settings from an empty native composer with no provider',async()=>{
 vi.mocked(request).mockImplementation(async method=>method==='snapshot'?{...base,providers:[]}:{});
 render(<App/>);
 const configure=await screen.findByRole('button',{name:'前往设置'});
 await userEvent.click(configure);
 expect(await screen.findByRole('dialog',{name:'设置中心'})).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'发送任务'})).toBeDisabled();
});
test('preserves orphan public tool events outside the empty-hero path',async()=>{
 vi.mocked(request).mockImplementation(async method=>method==='snapshot'?{...base,events:[{id:'e',projectId:'p',conversationId:'c',taskId:'missing',type:'tool_start',payload:{toolCallId:'r',toolName:'read',args:{path:'visible.ts'}}}]}:{});
 render(<App/>);
 expect(await screen.findByRole('region',{name:'实际工具轨迹'})).toBeInTheDocument();
 expect(screen.queryByRole('heading',{name:'今天想完成什么？'})).toBeNull();
});
