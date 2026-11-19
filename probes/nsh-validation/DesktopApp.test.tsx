import { expect, open, test } from 'nsh/test';
function handlers() {
  let count=0, stopped=false;
  const answer=(result:unknown)=>({version:1,id:'native-id',ok:true,result});
  const t=(p:any,status:string)=>({id:p.taskId??`task-${count}`,projectId:p.projectId,sessionId:p.sessionId,status,errorCode:null});
  return {
    'projects.list':()=>answer({projects:[{id:'a',name:'Desktop A'},{id:'b',name:'Desktop B'}]}),
    'sessions.list':(p:any)=>answer({sessions:[{id:`s-${p.projectId}`,projectId:p.projectId,title:'新会话'}]}),
    'sessions.create':(p:any)=>answer({session:{id:'new',projectId:p.projectId,title:p.title}}),
    'tasks.submit':(p:any)=>{count++;stopped=false;return answer({task:t(p,'queued'),replayed:false});},
    'tasks.events':(p:any)=>answer({task:t(p,stopped?'cancelled':'running'),terminal:stopped,events:p.cursor?[]:[{sequence:1,type:'text_delta',payload:{delta:'真实公开文本投影',truncated:false}},{sequence:2,type:'tool_start',payload:{toolCallId:'x',toolName:'bash'}}],cursor:`${p.taskId}:2`,hasMore:false}),
    'tasks.cancel':(p:any)=>{stopped=true;return answer({task:t(p,'running')});},
  };
}
test('desktop controls submit ordinary text once, stop and isolate project/session display',async()=>{
  const app=await open('./DesktopApp.tsx',{width:900,height:720,host:{handlers:handlers()}});
  await app.waitFor('text:项目 Desktop A');await app.type('id:prompt','你好 arbitrary');await app.press('id:primary-action');
  await app.waitFor('text:真实公开文本投影');expect(app.shows('id:icon-send')).toBe(false);
  await app.waitFor('text:命令 · 开始');await app.press('id:project-Desktop B');await app.waitFor('text:项目 Desktop B');
  expect(app.shows('text:真实公开文本投影')).toBe(false);await app.press('id:project-Desktop A');await app.waitFor('text:真实公开文本投影');
  await app.press('id:primary-action');await app.waitUntil(()=>app.texts().some(t=>t.includes('cancelled · 已排空')));
  expect(app.host.calls().filter(c=>c.name==='tasks.submit')).toHaveLength(1);
  await app.press('id:create-session');await app.waitFor('id:session-新会话 2');expect(app.shows('text:真实公开文本投影')).toBe(false);
});
test('desktop Host rejection is visible and never looks like successful completion',async()=>{
  const h=handlers();h['tasks.submit']=()=>{throw Error('secret /private/path');};
  const app=await open('./DesktopApp.tsx',{host:{handlers:h}});await app.waitFor('text:项目 Desktop A');await app.type('id:prompt','error');await app.press('id:primary-action');
  await app.waitUntil(()=>app.texts().some(t=>t.includes('desktop_unavailable')));expect(app.texts().join(' ').includes('/private/path')).toBe(false);expect(app.enabled('id:primary-action')).toBe(false);
  expect(app.host.calls().filter(c=>c.name==='tasks.submit')).toHaveLength(1);
});
