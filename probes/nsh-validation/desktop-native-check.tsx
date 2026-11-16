import { host, mount, Text } from 'nsh';
import type { Calls, Method, Response, Scope, PublicEvent } from './desktop-contract';
mount(() => <Text>Isolated desktop native bridge acceptance (Mac Catalyst)</Text>);
let checks = 0;
function check(value: unknown): asserts value { if (!value) throw new Error('assertion'); checks++; }
async function denied(method: string, params: unknown, code = 'ERR_ACCESS_DENIED') {
  try { await host.call(method, params); } catch (error) { check((error as { code?: string }).code === code); return; }
  throw new Error('unexpected permission');
}
async function call<M extends Method>(method: M, params: Calls[M]['params']): Promise<Calls[M]['result']> {
  const response = await host.call<Response<M>>(method, params, { timeout: 15000 });
  check(response.version === 1 && response.ok === true);
  return response.result;
}
async function poll(scope: Scope, taskId: string, untilStart = false) {
  let cursor: string | null = null;
  const events: PublicEvent[] = [];
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const page: Calls['tasks.events']['result'] = await call('tasks.events', { ...scope, taskId, cursor, limit: 3 });
    events.push(...page.events); cursor = page.cursor;
    if (untilStart && events.some(e => e.type === 'tool_start' && e.payload.toolName === 'bash')) return page;
    if (page.terminal && !page.hasMore) return { ...page, events };
    if (!page.hasMore) await new Promise(r => setTimeout(r, 25));
  }
  throw new Error('poll timeout');
}
async function run() {
  if (host.params.scenario === 'timeout') {
    const before = Date.now();
    await denied('projects.list', {}, 'ERR_NSH_HOST_ERROR');
    check(Date.now() - before >= 300 && Date.now() - before < 3000);
    await denied('projects.list', {}, 'ERR_NSH_HOST_ERROR');
    const closed = await host.call<{ clean: boolean }>('check.destroy'); check(closed.clean);
    await denied('projects.list', {}, 'ERR_NSH_HOST_ERROR');
  } else if (host.params.scenario === 'denied') {
    for (const method of ['projects.list', 'sessions.list', 'sessions.create', 'tasks.submit', 'tasks.cancel', 'tasks.events']) await denied(method, {});
  } else {
    for (const method of ['shell.run', 'files.read', 'url.open', 'spawn']) await denied(method, { path: '/tmp', command: 'id' });
    await denied('projects.list', null, 'ERR_NSH_HOST_ERROR');
    const parallel = await Promise.all([call('projects.list', {}), call('projects.list', {})]);
    check(parallel[0].projects.length === 2 && parallel[1].projects.length === 2);
    check(!JSON.stringify(parallel).includes('path'));
    const projectId = parallel[0].projects[0].id;
    const sessionId = (await call('sessions.create', { projectId, title: 'NSH native bridge' })).session.id;
    const scope = { projectId, sessionId };
    const sessions = await call('sessions.list', { projectId });
    check(sessions.sessions.some(s => s.id === sessionId));
    for (const params of [{ arbitrary: 'path' }, { projectId, path: '/tmp' }]) {
      const r = await host.call<Response<'sessions.list'>>('sessions.list', params); check(!r.ok && r.error.code === 'invalid_request');
    }
    const args = { ...scope, requestId: 'native-ordinary', text: '你好，真实原生桥' };
    const submitted = await call('tasks.submit', args);
    const done = await poll(scope, submitted.task.id);
    check(done.task.status === 'succeeded');
    check(done.events.filter(e => e.type === 'text_delta').map(e => e.payload.delta).join('').includes('本地夹具响应'));
    const replay = await call('tasks.submit', args); check(replay.replayed && replay.task.id === submitted.task.id);
    const tool = await call('tasks.submit', { ...scope, requestId: 'native-write', text: 'MOOS_FIXTURE_WRITE NATIVE_OK' });
    const tools = await poll(scope, tool.task.id);
    check(tools.task.status === 'succeeded' && tools.events.some(e => e.type === 'tool_end' && e.payload.toolName === 'read'));
    const foreign = (await call('sessions.list', { projectId: parallel[0].projects[1].id })).sessions[0];
    const deniedScope = await host.call<Response<'tasks.cancel'>>('tasks.cancel', { projectId: foreign.projectId, sessionId: foreign.id, taskId: tool.task.id });
    check(!deniedScope.ok && deniedScope.error.code === 'not_found');
    const hold = await call('tasks.submit', { ...scope, requestId: 'native-stop', text: 'MOOS_FIXTURE_HOLD' });
    await poll(scope, hold.task.id, true);
    await call('tasks.cancel', { ...scope, taskId: hold.task.id });
    check((await poll(scope, hold.task.id)).task.status === 'cancelled');
    const eof = await call('tasks.submit', { ...scope, requestId: 'native-eof', text: 'MOOS_FIXTURE_HOLD' });
    await poll(scope, eof.task.id, true);
    if (host.params.exitCheck === true) {
      await host.call('check.ready');
      return; // The native owner independently requests normal exit with the registered tool active.
    }
    // Test-only owner hook removes all six handlers and waits for the active Host to drain.
    const destroyed = await host.call<{ clean: boolean; forced: boolean }>('check.destroy'); check(destroyed.clean && !destroyed.forced);
    await denied('projects.list', {}, 'ERR_NSH_HOST_ERROR');
  }
  await host.call('check.report', { passed: true, checks });
}
run().catch(() => host.call('check.report', { passed: false, checks }));
