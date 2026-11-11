import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './store.mjs';
import { Scheduler } from './scheduler.mjs';

const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function until(check) {
  for (let i = 0; i < 100; i++) { if (check()) return; await turn(); }
  assert.fail('scheduler did not reach expected state');
}
async function fixture(t, run, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'moos-scheduler-'));
  const store = new Store({ dbPath: join(root, 'db.sqlite') });
  const conversations = [];
  for (const name of ['a', 'b', 'c']) {
    const path = join(root, name); await mkdir(path);
    const p = await store.addProject(path);
    conversations.push(store.createConversation(p.id));
  }
  const published = [];
  const scheduler = new Scheduler({ store, run, onEvent: e => published.push(e), ...options });
  t.after(async () => { await scheduler.shutdown(); store.close(); await rm(root, { recursive: true, force: true }); });
  return { store, scheduler, conversations, published };
}

test('submit persists immediately; runner receives context and persists ordered events and assistant text', async t => {
  let context;
  const { store, scheduler, conversations: [c], published } = await fixture(t, async ctx => {
    context = ctx; ctx.emit('output', { text: 'partial' }); return { text: 'answer' };
  });
  const task = scheduler.submit({ conversationId: c.id, message: 'question' });
  assert.equal(task.status, 'queued');
  assert.equal(store.listMessages(c.id)[0].content, 'question');
  await until(() => store.getTask(task.id).status === 'succeeded');
  assert.equal(context.project.id, c.projectId);
  assert.equal(context.conversation.id, c.id);
  assert.equal(context.task.id, task.id);
  assert.equal(context.signal.aborted, false);
  assert.deepEqual(store.listMessages(c.id).map(m => [m.role, m.content]), [['user', 'question'], ['assistant', 'answer']]);
  assert.deepEqual(published.map(e => e.type === 'task_state' ? e.payload.status : e.type), ['queued', 'running', 'output', 'succeeded']);
  assert.deepEqual(store.listEvents(task.id), published);
});

test('canonical directory serializes conversations while other projects use bounded concurrency', async t => {
  const starts = []; const gates = new Map(); let active = 0; let peak = 0;
  const { store, scheduler, conversations: [a, b, c] } = await fixture(t, async ({ task }) => {
    active++; peak = Math.max(peak, active); starts.push(task.id);
    const gate = deferred(); gates.set(task.id, gate); await gate.promise; active--; return { text: 'ok' };
  });
  const a2 = store.createConversation(a.projectId);
  const tasks = [a, a2, b, c].map(x => scheduler.submit({ conversationId: x.id, message: 'go' }));
  await until(() => starts.length === 2);
  assert.deepEqual(starts, [tasks[0].id, tasks[2].id]);
  gates.get(tasks[0].id).resolve();
  await until(() => starts.length === 3);
  assert.equal(starts[2], tasks[1].id);
  gates.get(tasks[1].id).resolve(); gates.get(tasks[2].id).resolve();
  await until(() => starts.length === 4);
  gates.get(tasks[3].id).resolve();
  await until(() => store.listTasks().every(x => x.status === 'succeeded'));
  assert.equal(peak, 2);
});

test('queued cancellation never runs; running cancellation retains slot and lock until settled and isolates other tasks', async t => {
  const starts = []; const gates = new Map(); const signals = new Map();
  const { store, scheduler, conversations: [a, b] } = await fixture(t, async ({ task, signal }) => {
    starts.push(task.id); signals.set(task.id, signal);
    const gate = deferred(); gates.set(task.id, gate); await gate.promise; return { text: 'late' };
  });
  const first = scheduler.submit({ conversationId: a.id, message: 'one' });
  const queued = scheduler.submit({ conversationId: a.id, message: 'two' });
  const other = scheduler.submit({ conversationId: b.id, message: 'three' });
  await until(() => starts.length === 2);
  scheduler.cancel(queued.id); scheduler.cancel(first.id);
  const next = scheduler.submit({ conversationId: a.id, message: 'four' });
  await turn();
  assert.equal(signals.get(first.id).aborted, true);
  assert.equal(signals.get(other.id).aborted, false);
  assert.equal(store.getTask(queued.id).status, 'cancelled');
  assert.equal(store.getTask(next.id).status, 'queued');
  assert.equal(starts.length, 2);
  gates.get(other.id).resolve();
  await until(() => store.getTask(other.id).status === 'succeeded');
  assert.equal(starts.length, 2);
  gates.get(first.id).resolve();
  await until(() => starts.length === 3);
  assert.equal(store.getTask(first.id).status, 'cancelled');
  assert.equal(store.listMessages(a.id).some(m => m.role === 'assistant'), false);
  gates.get(next.id).resolve();
  await until(() => store.getTask(next.id).status === 'succeeded');
  assert.throws(() => scheduler.cancel('missing'), /not found/i);
});

test('failures are sanitized, observer failures isolated, late emits ignored', async t => {
  let late;
  const { store, scheduler, conversations: [c] } = await fixture(t, async ({ emit }) => {
    late = emit; throw new Error('Authorization: Bearer secret-key /private/user');
  }, { onEvent: () => { throw new Error('observer'); } });
  const task = scheduler.submit({ conversationId: c.id, message: 'go' });
  await until(() => store.getTask(task.id).status === 'failed');
  assert.equal(store.getTask(task.id).errorCode, 'auth');
  assert.equal(store.getTask(task.id).error, '模型服务认证失败，请检查 API 密钥。');
  const count = store.listEvents().length;
  late('output', { text: 'too late' });
  assert.equal(store.listEvents().length, count);
  assert.equal(store.listEvents(task.id).at(-1).payload.errorCode, 'auth');
});

test('running tasks persist heartbeat and stage without fabricating model output', async t => {
  const gate = deferred();
  const { store, scheduler, conversations: [c] } = await fixture(t, async ({ emit }) => {
    emit('tool_start', { toolName: 'bash' });
    await gate.promise;
    return { text: 'done' };
  }, { heartbeatMs: 5 });
  const task = scheduler.submit({ conversationId: c.id, message: 'go', timeoutMs: 7200000 });
  await until(() => store.listEvents(task.id).some(event => event.type === 'task_heartbeat'));
  const running = store.getTask(task.id);
  assert.equal(running.timeoutMs, 7200000);
  assert.equal(running.stage, 'tool');
  assert.match(running.heartbeatAt, /^\d{4}-/);
  assert(!store.listEvents(task.id).some(event => event.type === 'text_delta'));
  gate.resolve();
  await until(() => store.getTask(task.id).status === 'succeeded');
});

test('shutdown cancels queued work and bounds waiting for an uncooperative runner', async t => {
  const gate = deferred(); let signal;
  const { store, scheduler, conversations: [c] } = await fixture(t, async ctx => {
    signal = ctx.signal; await gate.promise; return { text: 'late' };
  });
  const task = scheduler.submit({ conversationId: c.id, message: 'go' });
  const queued = scheduler.submit({ conversationId: c.id, message: 'wait' });
  await until(() => signal);
  const result = await scheduler.shutdown({ timeoutMs: 20 });
  assert.equal(result.drained, false);
  assert.equal(signal.aborted, true);
  assert.equal(store.getTask(queued.id).status, 'cancelled');
  assert.throws(() => scheduler.submit({ conversationId: c.id, message: 'no' }), /shut down/i);
  gate.resolve();
  assert.equal((await scheduler.shutdown()).drained, true);
  assert.equal(store.getTask(task.id).status, 'cancelled');
});

test('native terminal leases share canonical task locks until every tab closes', async t => {
  const ran = [];
  const { scheduler, store, conversations: [a, b] } = await fixture(t, async ({ task }) => { ran.push(task.id); return { text: 'done' }; });
  assert.equal(scheduler.reserveTerminal(a.projectId, 'tab1').ok, true);
  assert.equal(scheduler.reserveTerminal(a.projectId, 'tab2').ok, true);
  assert.equal(scheduler.reserveTerminal(a.projectId, 'tab2').ok, false);
  const first = scheduler.submit({ conversationId: a.id, message: 'wait for terminal' });
  const second = scheduler.submit({ conversationId: b.id, message: 'other project' });
  await until(() => store.getTask(second.id).status === 'succeeded');
  assert.equal(store.getTask(first.id).status, 'queued');
  assert.equal(scheduler.reserveTerminal(a.projectId, 'tab3').code, 'workspace_busy');
  scheduler.releaseTerminal('tab1'); await turn();
  assert.equal(store.getTask(first.id).status, 'queued');
  scheduler.releaseTerminal('tab2');
  await until(() => store.getTask(first.id).status === 'succeeded');
  assert.deepEqual(ran, [second.id, first.id]);
});

test('active task prevents acquiring a terminal and shutdown prevents new leases', async t => {
  const gate = deferred();
  const { scheduler, store, conversations: [c] } = await fixture(t, async () => { await gate.promise; return { text: 'done' }; });
  const task = scheduler.submit({ conversationId: c.id, message: 'work' });
  await until(() => store.getTask(task.id).status === 'running');
  assert.equal(scheduler.reserveTerminal(c.projectId, 'new').code, 'workspace_busy');
  gate.resolve(); await until(() => store.getTask(task.id).status === 'succeeded');
  await scheduler.shutdown();
  assert.equal(scheduler.reserveTerminal(c.projectId, 'late').ok, false);
});

test('tasks exceeding their timeout are stopped at the next heartbeat and marked failed with errorCode timeout', async t => {
  let simulated = 1000;
  const clock = () => simulated;
  const gate = deferred(); let runnerSignal;
  const { store, scheduler, conversations: [c], published } = await fixture(t, async ctx => {
    runnerSignal = ctx.signal;
    await new Promise((resolve, reject) => {
      ctx.signal.addEventListener('abort', () => reject(new Error('aborted by timeout')));
      gate.promise.then(resolve, reject);
    });
    return { text: 'must not be recorded' };
  }, { heartbeatMs: 5, clock });
  const task = scheduler.submit({ conversationId: c.id, message: 'long work', timeoutMs: 600000 });
  await until(() => store.getTask(task.id).status === 'running');
  assert.equal(runnerSignal.aborted, false);
  simulated += 600001; // 推进模拟时钟越过上限；真实心跳最多一个周期后触发。
  await until(() => store.getTask(task.id).status === 'failed');
  assert.equal(store.getTask(task.id).errorCode, 'timeout');
  assert.equal(store.getTask(task.id).error, '任务执行超过设定上限（10 分钟），已按设置停止');
  assert.equal(runnerSignal.aborted, true);
  gate.resolve(); await turn(); await turn();
  assert.equal(store.getTask(task.id).status, 'failed', 'late runner settlement must not overwrite the timeout result');
  assert.equal(store.listMessages(c.id).some(m => m.role === 'assistant'), false, 'timeout records no assistant text');
  assert.deepEqual(published.filter(e => e.type === 'task_state').map(e => e.payload.status),
    ['queued', 'running', 'failed']);
});

test('timeout clock starts at execution, so queue waiting never consumes the budget', async t => {
  let simulated = 1000;
  const clock = () => simulated;
  const gates = new Map();
  const { store, scheduler, conversations: [a] } = await fixture(t, async ({ task, signal }) => {
    const gate = deferred(); gates.set(task.id, gate);
    await new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
      gate.promise.then(resolve, reject);
    });
    return { text: 'ok' };
  }, { heartbeatMs: 5, clock });
  const first = scheduler.submit({ conversationId: a.id, message: 'holds the slot', timeoutMs: 86400000 });
  const second = scheduler.submit({ conversationId: a.id, message: 'queued behind', timeoutMs: 600000 });
  await until(() => store.getTask(first.id).status === 'running');
  assert.equal(store.getTask(second.id).status, 'queued');
  simulated += 700000; // 超过第二个任务的全部预算，但它仍在排队：不得消耗。
  await turn(); await turn(); await turn();
  assert.equal(store.getTask(second.id).status, 'queued', 'queued waiting must not trigger the timeout');
  gates.get(first.id).resolve();
  await until(() => store.getTask(first.id).status === 'succeeded');
  assert.equal(store.getTask(first.id).errorCode, null, 'success inside its own larger budget is unaffected');
  await until(() => store.getTask(second.id).status === 'running');
  simulated += 600001; // 从第二个任务实际开始执行起算。
  await until(() => store.getTask(second.id).status === 'failed');
  assert.equal(store.getTask(second.id).errorCode, 'timeout');
  gates.get(second.id).resolve(); await turn();
});

test('invalid scheduler clock is rejected', async t => {
  const { store, conversations: [c] } = await fixture(t, async () => ({ text: 'ok' }));
  assert.throws(() => new Scheduler({ store, run: async () => ({ text: 'x' }), clock: 123 }), /Invalid scheduler clock/);
});
