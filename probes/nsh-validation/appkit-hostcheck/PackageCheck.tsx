import { host, mount, signal, Text, View } from 'nsh';
import { Application } from 'nsh/desktop';

const label = signal('沐码 · AppKit 隔离验收');
let laidOut = false;
mount(() => <View class="flex-1" onLayout={({ bounds: { size } }) => { laidOut ||= size.width > 0 && size.height > 0; }}><Text>{label()}</Text></View>);

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function check(ok: unknown) { if (!ok) throw Error('package check'); }
type Scope = { projectId: string; sessionId: string };
type Id = { id: string };
type History = Scope & { before: string | null; messages: { role: string; text: string }[] };
type Event = { type: string; payload: { delta?: string; toolName?: string; isError?: boolean } };
type Page = { task: { status: string }; events: Event[]; cursor: string; terminal: boolean; hasMore: boolean };
async function rpc<T>(name: string, params: object = {}): Promise<T> {
  const response = await host.call<{ ok: boolean; result: T }>(name, params, { timeout: 11000 });
  if (!response.ok) throw Error('package RPC failed');
  return response.result;
}
const first = 'N01_RESTART_FIRST', reply = `本地夹具响应：${first}`;
let stage = 'layout';

async function run() {
  const ready = Date.now() + 5000;
  while (!laidOut && Date.now() < ready) await sleep(25);
  check(laidOut && host.available());
  stage = 'scope';
  const { projects, models } = await rpc<{ projects: Id[]; models: { defaultId: string } }>('projects.list');
  check(projects.length === 2 && models.defaultId === 'fixture');
  async function scopeFor(projectId: string): Promise<Scope> {
    const { sessions } = await rpc<{ sessions: Id[] }>('sessions.list', { projectId });
    check(sessions.length === 1);
    return { projectId, sessionId: sessions[0].id };
  }
  const scope = await scopeFor(projects[0].id);
  const history = (s: Scope) => rpc<History>('sessions.history', { ...s, before: null });
  const previous = await history(scope);
  const restart = previous.messages.length > 0;
  const other = await history(await scopeFor(projects[1].id));
  check(previous.projectId === scope.projectId && previous.sessionId === scope.sessionId && previous.before === null && other.messages.length === 0);
  const submit = async (requestId: string, text: string) => (await rpc<{ task: Id }>('tasks.submit', { ...scope, requestId, text })).task.id;
  async function poll(taskId: string, active = false) {
    const deadline = Date.now() + 12000;
    let cursor: string | null = null, backlog = false;
    const events: Event[] = [];
    while (Date.now() < deadline) {
      const result: Page = await rpc('tasks.events', { ...scope, taskId, cursor, limit: active ? 50 : 1 });
      events.push(...result.events); cursor = result.cursor;
      if (active) {
        check(!result.terminal);
        if (events.some(e => e.type === 'tool_start' && e.payload.toolName === 'bash')) return;
      } else if (result.terminal && !result.hasMore) {
        return { status: result.task.status, backlog, events, text: events.filter(e => e.type === 'text_delta').map(e => e.payload.delta).join('') };
      }
      backlog ||= result.terminal && result.hasMore;
      if (!result.hasMore) await sleep(20);
    }
    throw Error('package task timeout');
  }
  stage = 'history before submission';
  check(restart ? previous.messages.length === 2 && previous.messages[0].role === 'user' && previous.messages[0].text === first &&
    previous.messages[1].role === 'assistant' && previous.messages[1].text === reply : previous.messages.length === 0);
  label.set(restart ? `${previous.messages[0].text}\n${previous.messages[1].text}` : '沐码 · 空历史');
  stage = 'PI turn';
  const turn = await poll(await submit(restart ? 'pack-reopen' : 'pack-first', restart ? 'N01_RESTART_CONTINUE' : first));
  check(turn?.status === 'succeeded' && turn?.text === (restart ? 'N01_CONTEXT_PRESERVED' : reply));
  check((await history(scope)).messages.length === previous.messages.length);
  if (restart) {
    stage = 'Stop and drain';
    const taskId = await submit('pack-stop', 'MOOS_FIXTURE_HOLD');
    await poll(taskId, true);
    await rpc('tasks.cancel', { ...scope, taskId });
    // Wait for terminal with the first page, then exercise the whole backlog.
    const deadline = Date.now() + 12000;
    for (;;) {
      const page = await rpc<Page>('tasks.events', { ...scope, taskId, cursor: null, limit: 1 });
      if (page.terminal) { check(page.hasMore); break; }
      check(Date.now() < deadline);
      await sleep(25);
    }
    const stopped = await poll(taskId);
    check(stopped?.status === 'cancelled' && stopped?.backlog);
    stage = 'resend with tools';
    const tools = await poll(await submit('pack-write', 'MOOS_FIXTURE_WRITE APPKIT_PACKAGE'));
    const done = tools?.events.filter(e => e.type === 'tool_end');
    check(tools?.status === 'succeeded' && tools?.text === '完成 APPKIT_PACKAGE' &&
      done?.map(e => e.payload.toolName).join(',') === 'write,read' && done.every(e => e.payload.isError === false));
  }
  await host.call('n01.complete', true);
  console.log(`N01_APPKIT_PACKAGE ${restart ? 'reopened' : 'first'} ${scope.projectId} ${scope.sessionId}`);
}
setTimeout(async () => {
  try { await run(); }
  catch { console.error(`N01_APPKIT_PACKAGE_FAILED ${stage}`); }
  finally { Application.quit(); }
}, 100);
