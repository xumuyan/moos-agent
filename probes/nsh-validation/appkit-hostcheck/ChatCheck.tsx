// Script the same DesktopView actions used by buttons, not a separate RPC client.
import { host, mount } from 'nsh';
import { Application } from 'nsh/desktop';
import { DesktopView, type DesktopActions } from './DesktopView';
import { desktopCall } from './desktop-ui-transport';
import type { Calls, Method } from './desktop-contract';

const firstText = 'N01_RESTART_FIRST';
const firstReply = `本地夹具响应：${firstText}`;
let ui: DesktopActions | undefined;
let stage = 'startup';
let holdCheck = false, bashActive = false, stopping = false, terminalBacklog = false, prematureSendBlocked = false;
let submissions = 0, polls = 0;
const geometry = new Set<string>();
const checks: string[] = [];
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function check(ok: unknown, name: string) {
  stage = name;
  if (!ok) throw Error('check failed');
  checks.push(name);
}
async function until(name: string, ready: () => unknown) {
  stage = name;
  const deadline = Date.now() + 32000;
  while (!ready()) {
    if (Date.now() >= deadline) throw Error('deadline');
    await sleep(25);
  }
}
async function call<M extends Method>(method: M, params: Calls[M]['params']): Promise<Calls[M]['result']> {
  if (method === 'tasks.submit') submissions++;
  if (method !== 'tasks.events') return desktopCall(method, params);
  polls++;
  const query = params as Calls['tasks.events']['params'];
  // Simulate a reader that falls behind during cancellation. Keep its cursor
  // unchanged until the Host reports terminal, then deliver genuine one-event
  // pages. No task status, event, or hasMore flag is fabricated.
  if (stopping && terminalBacklog && !prematureSendBlocked) {
    const current = ui!.controller.current;
    check(current?.task?.status === 'cancelled' && current.busy && !current.drained, 'controller observes terminal backlog');
    const before = submissions;
    ui!.type('MUST_NOT_SEND_DURING_DRAIN'); ui!.send();
    prematureSendBlocked = submissions === before;
  }
  if (holdCheck && query.cursor === null) {
    const deadline = Date.now() + 8000;
    // Inspect genuine Host pages without handing them to the controller yet.
    // Cancellation may suppress tool_end, so leaving only one unconsumed
    // event after tool_start would not demonstrate terminal with backlog.
    while (Date.now() < deadline) {
      const observed = await desktopCall('tasks.events', query);
      bashActive ||= !observed.terminal && observed.events.some(e => e.type === 'tool_start' && e.payload.toolName === 'bash');
      if (stopping && observed.terminal) break;
      await sleep(25);
    }
    const page = await desktopCall('tasks.events', { ...query, limit: 1 });
    terminalBacklog = page.terminal && page.hasMore;
    return page as Calls[M]['result'];
  }
  return desktopCall('tasks.events', stopping ? { ...query, limit: 1 } : query) as Promise<Calls[M]['result']>;
}
mount(() => <DesktopView persistentHistory call={call} ready={value => { ui = value; }}
  onGeometry={(name, { size }) => { if (size.width > 0 && size.height > 0) geometry.add(name); }} />);

async function run() {
  await until('history before Send', () => ui?.history());
  const actions = ui!, c = actions.controller, current = c.current!;
  const { scope } = current, page = actions.history()!;
  const restart = page.messages.length > 0;
  const catalog = await desktopCall('projects.list', {});
  check(catalog.projects.length === 2 && catalog.models?.defaultId === 'fixture' &&
    catalog.models.options.some(m => m.id === 'fixture-alternate'), 'fixture catalog');
  await until('native chat layout', () => ['sidebar', 'messages', 'primary-action', 'composer-add'].every(n => geometry.has(n)));
  check(current.task === null && current.rows.length === 0 && submissions === 0 && page.before === null &&
    page.projectId === scope.projectId && page.sessionId === scope.sessionId, 'no replay before Send');
  if (restart) {
    check(page.messages.length === 2 && page.messages[0].role === 'user' && page.messages[0].text === firstText &&
      page.messages[1].role === 'assistant' && page.messages[1].text === firstReply, 'exact pre-Send history');
    await until('native historical row layout', () => geometry.has('message-你') && geometry.has('message-PI 公开文本'));
    check(true, 'old rows laid out');
    const other = c.projects.find(p => p.id !== scope.projectId)!;
    await actions.project(other.id);
    await until('other history', () => actions.history()?.projectId === other.id);
    check(actions.history()?.messages.length === 0 && c.current?.rows.length === 0, 'other project stays empty');
    await actions.project(scope.projectId); actions.session(scope.sessionId);
    await until('same scope', () => actions.history()?.sessionId === scope.sessionId);
    check(c.current === current && actions.history()?.messages.length === 2, 'scope round trip');
  } else {
    check(page.messages.length === 0, 'empty profile');
  }
  const send = (text: string) => { actions.type(text); actions.send(); };
  const drained = (previous?: string) => current.task && current.task.id !== previous && current.drained;
  send(restart ? 'N01_RESTART_CONTINUE' : firstText);
  await until('first Send drains', () => drained());
  check(current.task?.status === 'succeeded' && current.rows.filter(r => r.role === '你').length === 1 &&
    current.rows.some(r => r.role === 'PI 公开文本' && r.body === (restart ? 'N01_CONTEXT_PRESERVED' : firstReply)),
    restart ? 'PI continued from prior context' : 'first public reply');
  check(actions.history()?.messages.length === (restart ? 2 : 0), 'live rows not duplicated by history');

  if (restart) {
    let previous = current.task!.id;
    holdCheck = true; send('MOOS_FIXTURE_HOLD');
    await until('bash active', () => current.task && current.task.id !== previous && bashActive);
    // tool_start can precede the command itself. Give the fixture time to
    // register its PID; the packager requires that file and verifies liveness.
    await sleep(400);
    previous = current.task!.id;
    stopping = true; actions.stop();
    await until('Stop drains', () => current.drained);
    check(current.task?.id === previous && current.task.status === 'cancelled' && terminalBacklog && prematureSendBlocked && submissions === 2 &&
      current.rows.some(r => r.body === 'tool_start · bash') &&
      !current.rows.some(r => r.body === 'MUST_NOT_SEND_DURING_DRAIN'), 'terminal backlog blocks Send until drained');
    holdCheck = stopping = false;
    send('MOOS_FIXTURE_WRITE APPKIT_CHAT');
    await until('same-session resend drains', () => drained(previous));
    check(c.current === current && current.task?.status === 'succeeded' && submissions === 3 &&
      current.rows.some(r => r.body === 'tool_end · write') && current.rows.some(r => r.body === 'tool_end · read') &&
      current.rows.some(r => r.body === '完成 APPKIT_CHAT'), 'resend write/read on original scope');
  }
  const lastPoll = polls;
  await sleep(550);
  check(lastPoll === polls && c.diagnostics.pending === 0 && c.diagnostics.timers === 0, 'no polling after drain');
  if (restart) {
    actions.toggleGoal(); send('N01_GOAL_REPAIR');
    await until('team goal independent repair and completion', () => actions.goal()?.status === 'completed' && current.drained);
    check(actions.goal()?.round === 2 && actions.goal()?.verifiedMembers === 1 && geometry.has('team-goal-status'), 'team goal repairs then independently completes');
    const priorGoal = actions.goal()!.id;
    const starts = () => current.rows.filter(r => r.role === '工具' && r.body === 'tool_start · bash').length;
    const priorStarts = starts();
    actions.toggleGoal(); send('N01_GOAL_PAUSE');
    await until('new goal owns live tool', () => actions.goal()?.id !== priorGoal && actions.goal()?.status === 'running' && starts() > priorStarts);
    await sleep(400);
    const pausedId = actions.goal()!.id;
    actions.stop();
    await until('team goal native pause drains', () => actions.goal()?.status === 'paused' && current.drained && geometry.has('team-goal-resume'));
    check(actions.goal()?.id === pausedId, 'team goal pauses after owned tool drains');
    actions.resumeGoal();
    await until('team goal resume completes', () => actions.goal()?.status === 'completed' && current.drained);
    check(actions.goal()?.id === pausedId && actions.goal()?.round === 2, 'team goal resumes the same objective');
    const png = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGNIn3qAJMQwqmFUw/DVAACx2bwQBikQCwAAAABJRU5ErkJggg==';
    actions.chooseModel({ modelId: 'fixture-alternate', reasoningEffort: 'high' });
    actions.attachImages([new File([Uint8Array.from(atob(png), c => c.charCodeAt(0))], 'fixture.png', { type: 'image/png' })]);
    const priorImageTask = current.task!.id;
    send('N01_PASTE_IMAGE');
    await until('attached image drains through private native transport', () => drained(priorImageTask));
    check(current.task?.status === 'succeeded' && current.rows.some(r => r.body === 'N01_IMAGE_RECEIVED'), 'clipboard image handed to PI');

    const added = await desktopCall('models.manage', { action: 'save',
      service: { id: null, name: 'Synthetic Relay', baseUrl: 'https://example.invalid/v1', api: 'openai-responses', service: 'openai', apiKey: 'test-fixture-only' },
      model: { id: null, label: 'Synthetic Sol', model: 'fixture-sol', maxTokens: 8192, contextWindow: 128000,
        efforts: ['off', 'high'], defaultEffort: 'high', imageInput: false } });
    check(added.services[0]?.name === 'Synthetic Relay' && added.models.options.some(m => m.label === 'Synthetic Sol' &&
      m.reasoning?.defaultId === 'high') && !JSON.stringify(added).includes('test-fixture-only'), 'native model configuration');
    const renamed = await desktopCall('sessions.manage', { ...scope, action: 'rename', title: 'AppKit verified session' });
    check(renamed.sessions[0]?.title === 'AppKit verified session', 'native session rename command');
    const archived = await desktopCall('sessions.manage', { ...scope, action: 'archive' });
    const list = await desktopCall('sessions.manage', { projectId: scope.projectId, action: 'listArchived' });
    const restored = await desktopCall('sessions.manage', { ...scope, action: 'restore' });
    const reopened = await desktopCall('sessions.history', { ...scope, before: null });
    check(!archived.sessions.some(s => s.id === scope.sessionId) && list.sessions.some(s => s.id === scope.sessionId) &&
      restored.selectedId === scope.sessionId && reopened.messages.some(m => m.text === firstText), 'native archive and restore keeps history');
  }
  await host.call('n01.complete', true);
  console.log(`N01_APPKIT_CHAT ${JSON.stringify({ restart, scope, checks })}`);
}
setTimeout(async () => {
  try { await run(); }
  catch {
    const current = ui?.controller.current;
    console.error(`N01_APPKIT_CHAT_FAILED ${stage} ${JSON.stringify({
      status: current?.task?.status, busy: current?.busy, drained: current?.drained, code: current?.error, submissions,
    })}`);
  }
  finally { Application.quit(); }
}, 100);
