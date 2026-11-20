// Scripted check inside the real candidate window. No fake Host replies or input injection.
import { host, mount } from 'nsh';
import { DesktopView, type DesktopActions } from './DesktopView';
import { desktopCall } from './desktop-ui-transport';
import type { Calls, Method } from './desktop-contract';

let actions: DesktopActions | undefined;
let stage = 'startup';
const checks: string[] = [];
const timings: Record<string, number> = {};
let eventCalls = 0;
let backlogPages = 0;
const measured = new Set<string>();
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function check(value: unknown, name: string) {
  if (!value) { stage = name; throw Error('check failed'); }
  checks.push(name);
}
async function until(name: string, ready: () => unknown, timeout = 10000) {
  stage = name;
  const start = Date.now();
  while (!ready()) {
    if (Date.now() - start >= timeout) throw Error('deadline');
    await sleep(20);
  }
  timings[name] = Date.now() - start;
}
async function call<M extends Method>(method: M, params: Calls[M]['params']): Promise<Calls[M]['result']> {
  if (method === 'tasks.events') {
    eventCalls++;
    if ((params as Calls['tasks.events']['params']).cursor === null && actions?.controller.current?.rows[0]?.body.startsWith('PAGE ')) {
      // Collect actual PI journal backlog, then let the unmodified controller drain it.
      await sleep(800);
    }
  }
  const start = Date.now();
  try {
    const result = await desktopCall(method, params);
    if (method === 'tasks.events' && (result as Calls['tasks.events']['result']).hasMore) backlogPages++;
    return result;
  } finally { timings[`max:${method}`] = Math.max(timings[`max:${method}`] ?? 0, Date.now() - start); }
}
mount(() => <DesktopView call={call} ready={value => { actions = value; }}
  onGeometry={(name, { size }) => { if (size.width > 0 && size.height > 0) measured.add(name); }} />);

async function run() {
  await until('startup', () => actions?.controller.current);
  const ui = actions!, c = ui.controller, first = c.current!;
  check(c.projects.length === 2 && first.rows.length === 0, 'isolated startup');
  await until('window layout', () => ['sidebar', 'chat-header', 'messages', 'primary-action'].every(name => measured.has(name)));
  check(measured.has('primary-action'), 'native window layout');
  function send(text: string) { ui.type(text); ui.send(); }
  send('你好，NSH PI 验证'); ui.send();
  await until('ordinary drain', () => first.task && first.drained);
  check(first.task?.status === 'succeeded' && first.rows.filter(r => r.role === '你').length === 1 &&
    first.rows.some(r => r.body.includes('本地夹具响应：你好，NSH PI 验证')), 'public text once');

  stage = 'tools session';
  await ui.create(); const tools = c.current!;
  check(tools !== first && tools.rows.length === 0, 'create selects clean session');
  send('MOOS_FIXTURE_WRITE NSH_UI');
  await until('tools drain', () => tools.task && tools.drained);
  check(tools.task?.status === 'succeeded' && tools.rows.some(r => r.body === 'tool_end · write') &&
    tools.rows.some(r => r.body === 'tool_end · read') && tools.rows.some(r => r.body === '完成 NSH_UI'), 'real write/read');

  const pid = c.projects[0].id;
  const other = c.projects[1].id;
  stage = 'switch project';
  await ui.project(other); const second = c.current!;
  check(second.scope.projectId === other && second.rows.length === 0, 'separate project');
  let denied = false;
  try {
    await desktopCall('tasks.events', { ...second.scope, taskId: tools.task!.id, cursor: null, limit: 1 });
  } catch (error) { denied = error instanceof Error && error.message === 'not_found'; }
  check(denied, 'foreign task denied');
  await ui.project(pid);
  ui.session(tools.scope.sessionId);
  check(c.current === tools && c.current.rows.some(r => r.body === '完成 NSH_UI'), 'session round trip');

  stage = 'page session';
  await ui.create(); const page = c.current!;
  send('PAGE ' + 'B'.repeat(3200));
  await until('page drain', () => page.task && page.drained);
  check(page.task?.status === 'succeeded' && page.sequence > 150 && page.polls >= 2 && backlogPages >= 1 &&
    page.rows.some(r => r.body.includes('B'.repeat(3200))), 'real multi-page drain');

  stage = 'stop session';
  await ui.create(); const stopped = c.current!;
  send('MOOS_FIXTURE_HOLD');
  await until('bash start', () => stopped.rows.some(r => r.body === 'tool_start · bash'));
  await ui.project(other);
  check(c.current === second && !second.rows.some(r => r.body.includes('HOLD')), 'working task stays scoped');
  await ui.project(pid); ui.session(stopped.scope.sessionId);
  check(c.current === stopped && stopped.busy, 'working session restored');
  ui.stop();
  await until('stop drain', () => stopped.drained);
  check(stopped.task?.status === 'cancelled', 'stop active command');
  const stoppedId = stopped.task!.id;
  send('停止后继续');
  await until('same session recovery', () => stopped.task?.id !== stoppedId && stopped.drained);
  check(stopped.task?.status === 'succeeded' && stopped.rows.some(r => r.body.includes('本地夹具响应：停止后继续')), 'send again after stop');
  const drainedCalls = eventCalls;
  await sleep(550);
  check(eventCalls === drainedCalls, 'no polling after drain');

  stage = 'disconnect session';
  await ui.create(); const broken = c.current!;
  send('MOOS_FIXTURE_HOLD');
  await until('disconnect bash start', () => broken.rows.some(r => r.body === 'tool_start · bash'));
  stage = 'disconnect cleanup';
  check((await host.call<{clean: boolean}>('piui.disconnect', {})).clean, 'active EOF drained');
  await until('disconnect visible to controller', () => broken.error);
  check(broken.error === 'desktop_unavailable' && !broken.drained && broken.task?.status !== 'succeeded', 'disconnect not success');
  c.dispose();
  check(c.diagnostics.pending === 0 && c.diagnostics.timers === 0, 'JS waiters disposed');
  await host.call('piui.report', { passed: true, stage: 'complete', checks, timings, eventCalls, backlogPages, backlogEvents: page.sequence, backlogPolls: page.polls });
}
void run().catch(async () => {
  await host.call('piui.report', { passed: false, stage, checks, timings, eventCalls });
});
