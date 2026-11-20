import { host, mount, signal, Text, View } from 'nsh';
import { Application } from 'nsh/desktop';
const stage = signal('boot');
let laidOut = false;
mount(() => <View class="flex-1" onLayout={({ bounds: { size } }) => { if (size.width > 0 && size.height > 0) laidOut = true; }}><Text>{stage()}</Text></View>);

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const require = (ok: unknown) => { if (!ok) throw Error('probe assertion'); };
type Reply<T> = { ok: true; result: T } | { ok: false; error: { code: string } };
type Id = { id: string };
type Event = { type: string; payload: { delta?: string; toolName?: string; isError?: boolean } };
type Page = { terminal: boolean; hasMore: boolean; cursor: string; events: Event[]; task: { status: string } };
async function wire<T>(name: string, params: object = {}): Promise<Reply<T>> {
  return await host.call(name, params, { timeout: 11000 }) as Reply<T>;
}
async function rpc<T>(name: string, params?: object): Promise<T> {
  const response = await wire<T>(name, params);
  if (!response.ok) throw Error('probe RPC failed');
  return response.result;
}
async function run() {
  const deadlineLayout = Date.now() + 5000;
  while (!laidOut && Date.now() < deadlineLayout) await sleep(25);
  require(laidOut);
  stage.set('capabilities');
  require(host.available());
  let denied: string | undefined;
  try { await host.call('profiles.import', {}); } catch (err) { denied = (err as { code?: string }).code; }
  require(denied === 'ERR_ACCESS_DENIED');
  stage.set('scope');
  const { projects, models } = await rpc<{projects: Id[]; models: {defaultId: string}}>('projects.list');
  require(projects.length === 2 && models.defaultId === 'fixture');
  const projectId = projects[0].id;
  const created = await rpc<{session: Id}>('sessions.create', { projectId, title: 'AppKit TSX synthetic' });
  const { sessions } = await rpc<{sessions: Id[]}>('sessions.list', { projectId });
  require(sessions.some(s => s.id === created.session.id));
  const scope = { projectId, sessionId: created.session.id };
  const submit = async (requestId: string, text: string) => (await rpc<{task: Id}>('tasks.submit', { ...scope, requestId, text })).task.id;
  const page = (taskId: string, cursor: string | null = null, limit = 1) => rpc<Page>('tasks.events', { ...scope, taskId, cursor, limit });
  async function wait(taskId: string, active = false) {
    const end = Date.now() + 12000;
    let cursor: string | null = null, backlog = false;
    const events: Event[] = [];
    while (Date.now() < end) {
      const p = await page(taskId, cursor, active ? 50 : 1);
      events.push(...p.events); cursor = p.cursor;
      if (active) {
        require(!p.terminal);
        if (events.some(e => e.type === 'tool_start' && e.payload.toolName === 'bash')) return;
      } else if (p.terminal && !p.hasMore) {
        return {status: p.task.status, events, backlog,
          text: events.filter(e => e.type === 'text_delta').map(e => e.payload.delta ?? '').join('')};
      }
      backlog ||= p.terminal && p.hasMore;
      if (!p.hasMore) await sleep(25);
    }
    throw Error('probe timeout');
  }
  stage.set('tools');
  const first = await submit('appkit-tsx-tools', 'MOOS_FIXTURE_WRITE APPKIT_TSX');
  const toolResult = await wait(first);
  const tools = toolResult?.events.filter(e => e.type === 'tool_end');
  require(toolResult?.status === 'succeeded' && toolResult.text.includes('完成 APPKIT_TSX') &&
    tools?.map(e => e.payload.toolName).join(',') === 'write,read' && tools.every(e => e.payload.isError === false));
  const foreign = await wire<Page>('tasks.events', {...scope, projectId: projects[1].id, taskId: first, cursor: null, limit: 1});
  require(!foreign.ok && foreign.error.code === 'not_found');
  stage.set('stop and drain');
  const stopped = await submit('appkit-tsx-stop', 'MOOS_FIXTURE_HOLD');
  await wait(stopped, true);
  await rpc('tasks.cancel', { ...scope, taskId: stopped });
  const deadline = Date.now() + 12000;
  for (;;) {
    const first = await page(stopped);
    if (first.terminal) { require(first.hasMore); break; }
    require(Date.now() < deadline);
    await sleep(25);
  }
  const drained = await wait(stopped);
  require(drained?.status === 'cancelled' && drained.backlog);
  stage.set('same-session resend');
  const resent = await wait(await submit('appkit-tsx-resend', 'APPKIT_TSX_RESEND'));
  require(resent?.status === 'succeeded' && resent.text.includes('本地夹具响应：APPKIT_TSX_RESEND'));
  stage.set('quit with active tool');
  await wait(await submit('appkit-tsx-quit', 'MOOS_FIXTURE_HOLD'), true);
  await host.call('n01.complete', true);
  stage.set('complete');
  console.log('N01_APPKIT_TSX_COMPLETE');
}
setTimeout(async () => {
  try { await run(); }
  catch { console.error(`N01_APPKIT_TSX_FAILED ${stage()}`); }
  finally { Application.quit(); }
}, 100);
