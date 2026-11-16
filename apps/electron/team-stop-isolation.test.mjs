import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Run the real Host in a separate Node process: Host runtime/data environment
// must not leak into other concurrently loaded Electron test files.
async function verify({ runtime, plugin, data, otherShell }) {
  const { default: assert } = await import('node:assert/strict');
  const { randomUUID } = await import('node:crypto');
  const { createServer } = await import('node:http');
  const { execFileSync } = await import('node:child_process');
  const { mkdir, readFile, open } = await import('node:fs/promises');
  const { constants } = await import('node:fs');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const { setTimeout: delay } = await import('node:timers/promises');
  const load = path => import(pathToFileURL(path).href);
  const { apply } = await load(join(plugin, 'host.js'));
  const { piModels } = await load(join(plugin, 'pi-models.js'));
  const { checkedProvider } = await load(join(runtime, 'packages/pi-adapter/index.mjs'));
  const { Store } = await load(join(runtime, 'services/agent/store.mjs'));
  const workspace = join(data, 'workspace');
  const paths = { A: join(workspace, 'alpha'), B: join(workspace, 'beta') };
  await Promise.all(Object.values(paths).map(path => mkdir(path, { recursive: true })));
  async function until(check, message) {
    for (let i = 0; i < 300; i++) { const value = await check(); if (value) return value; await delay(25); }
    assert.fail(message);
  }
  if (otherShell) execFileSync('/usr/bin/mkfifo', [join(paths.B, 'release.fifo')]);
  const checks = {}, errors = [], requests = [];
  let heldResponse, heldClosed = false;
  const respond = (res, name, args, content) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const delta = name ? { tool_calls: [{ index: 0, id: 'call-' + requests.length, type: 'function',
      function: { name, arguments: JSON.stringify(args) } }] } : { content };
    for (const [part, finish] of [[delta, null], [{}, name ? 'tool_calls' : 'stop']]) {
      res.write('data: ' + JSON.stringify({ id: 'local-fixture', object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: part, finish_reason: finish }] }) + '\n\n');
    }
    res.end('data: [DONE]\n\n');
  };
  const server = createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw); requests.push(body);
      const user = body.messages.filter(item => item.role === 'user').at(-1);
      const prompt = typeof user.content === 'string' ? user.content : user.content.map(part => part.text ?? '').join('');
      const owner = prompt.includes('PROJECT_A') ? 'A' : prompt.includes('PROJECT_B') ? 'B' : undefined;
      assert.ok(owner, 'every request has the correct synthetic project marker');
      const names = body.tools?.map(item => item.function.name) ?? [];
      const latest = body.messages.at(-1).role === 'tool' ? body.messages.at(-1) : undefined;
      const latestTool = latest && body.messages.flatMap(message => message.tool_calls ?? [])
        .find(call => call.id === latest.tool_call_id)?.function.name;
      let name, args, content;
      if (prompt.includes('只根据已有工具/成员证据')) {
        assert.equal(owner, 'B', 'cancelled A must never summarize');
        assert.deepEqual(names, []); content = 'PROJECT_B_DELIVERED';
      } else if (names.includes('team_plan')) {
        if (latest) content = 'planned';
        else { name = 'team_plan'; args = { tasks: [
          { id: 'build', role: 'implementer', goal: owner === 'A' ? 'Run cancellable shell' : 'Write independent beta artifact', dependsOn: [] },
          { id: 'check', role: 'verifier', goal: 'Read own artifact independently', dependsOn: ['build'] },
        ] }; }
      } else if (names.includes('team_verdict')) {
        assert.equal(owner, 'B', 'cancelled A must never start verification');
        if (!latest) { name = 'read'; args = { path: 'answer.txt' }; }
        else if (latestTool === 'read') {
          assert.ok(latest.content.includes('B_ONLY_42'));
          name = 'team_verdict'; args = { passed: true, summary: 'Own beta artifact read independently' };
        } else content = 'verified';
      } else if (prompt.includes('当前任务build')) {
        if (owner === 'A') {
          assert.equal(latest, undefined, 'A shell must not reach another model request after cancellation');
          name = 'bash'; args = { command: `printf 'A_ONLY_42\\n' > answer.txt; printf '%s\\n' "$$" > shell.pid; /bin/sleep 120 & worker=$!; printf '%s\\n' "$worker" > child.pid; wait "$worker"; printf 'UNEXPECTED_LATE_WRITE\\n' > late.txt`, timeout: 150 };
        } else if (!latest && otherShell) {
          name = 'bash'; args = { command: `printf '%s\\n' "$$" > shell.pid; /bin/cat release.fifo > release.txt & worker=$!; printf '%s\\n' "$worker" > child.pid; wait "$worker" && test "$(cat release.txt)" = 'RELEASE_B' && printf 'B_ONLY_42\\n' > answer.txt`, timeout: 150 };
        } else if (!latest) {
          assert.equal(heldResponse, undefined, 'only one B model response is held');
          heldResponse = res; res.once('close', () => { heldClosed = true; }); return;
        } else content = 'written';
      } else content = 'PROJECT_A_ORDINARY';
      respond(res, name, args, content);
    } catch (error) { errors.push(error); res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const disposers = [], controllers = [];
  let store, adapter, executor, seq = 0;
  const sessions = new Map(Object.entries(paths).map(([owner, cwd]) => [owner, { id: owner, header: { cwd } }]));
  try {
    const models = piModels(data, checkedProvider);
    await models.save({ id: 'local', model: 'fixture-model', api: 'openai-completions',
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'synthetic-local-only' });
    const ctx = {
      effect(setup) { disposers.push(setup()); },
      tools: { setExecutor(value) { executor = value; return () => {}; } },
      agents: { get: id => ({ session: sessions.get(id) }), turnBoundaryOf: () => ({ openTurnStartSeq: ++seq }) },
      llm: { registerAdapter(_routes, value) { adapter = value; return () => {}; } },
      sandboxPolicy: { resolve: () => ({ mode: 'workspace-write' }) },
      approval: { request: () => { throw new Error('Unexpected approval'); } },
      on(event, fn) { if (event === 'dispose') disposers.push(fn); }, emit() {},
    };
    await apply(ctx);
    assert.deepEqual(executor.describe(), { schemas: [], knownNames: [] });
    await assert.rejects(executor.execute(), /由 PI 执行/);
    checks.legacyExecutorDisabled = true;
    store = new Store({ dbPath: join(data, 'pi/moos.sqlite') });
    function start(owner, mode) {
      const controller = new AbortController(); controllers.push(controller);
      const stream = adapter.stream({ sessionId: owner, model: 'local', signal: controller.signal, messages: [{
        role: 'user', source: { kind: 'user', rpcId: `moos-pi-mode:v1:${mode}:${randomUUID()}` },
        content: [{ type: 'text', text: `PROJECT_${owner} ${mode === 'team' ? 'Produce own artifact and independently verify' : 'Reply ordinary'}` }],
      }] });
      const events = [];
      const done = (async () => { for await (const event of stream) events.push(event); return events; })();
      // Register rejection handling immediately while assertions inspect live work.
      done.catch(() => {});
      return { controller, done, events };
    }
    const a = start('A', 'team');
    const parent = pid => Number(execFileSync('/bin/ps', ['-p', String(pid), '-o', 'ppid='], { encoding: 'utf8' }).trim());
    async function ownedPids(owner) {
      const pids = await until(async () => {
        try {
          const rows = await Promise.all(['shell.pid', 'child.pid'].map(file => readFile(join(paths[owner], file), 'utf8').then(Number)));
          return rows.every(pid => Number.isSafeInteger(pid) && pid > 1) && rows;
        } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
      }, owner + ' actual shell PID files');
      assert.notEqual(pids[0], pids[1]);
      assert.equal(parent(pids[1]), pids[0], owner + ' direct child of actual shell');
      let ancestor = pids[0]; const seen = new Set();
      while (ancestor !== process.pid && ancestor > 1 && !seen.has(ancestor)) { seen.add(ancestor); ancestor = parent(ancestor); }
      assert.equal(ancestor, process.pid, owner + ' shell belongs to this exact isolated Host process');
      return pids;
    }
    const pids = await ownedPids('A');
    const b = start('B', 'team');
    const betaPids = otherShell ? await ownedPids('B') : undefined;
    if (!otherShell) await until(() => heldResponse, 'B active implementer model request');
    if (otherShell) {
      assert.equal(new Set([...pids, ...betaPids]).size, 4, 'separate real tool processes');
      checks.bActualOwnedShellAndChildRunning = true;
    }
    const tasks = store.listTasks(); assert.equal(tasks.length, 2);
    const alpha = tasks.find(task => task.message.includes('PROJECT_A'));
    const beta = tasks.find(task => task.message.includes('PROJECT_B'));
    assert.ok(alpha && beta);
    assert.notEqual(alpha.projectId, beta.projectId);
    assert.notEqual(alpha.conversationId, beta.conversationId);
    assert.equal(store.getProject(alpha.projectId).path, paths.A);
    assert.equal(store.getProject(beta.projectId).path, paths.B);
    assert.ok(tasks.every(task => task.status === 'running'));
    assert.ok(store.listEvents(alpha.id).some(event => event.type === 'tool_start' && event.payload.member === 'implementer' && event.payload.toolName === 'bash'));
    if (otherShell) assert.ok(store.listEvents(beta.id).some(event => event.type === 'tool_start' && event.payload.member === 'implementer' && event.payload.toolName === 'bash'));
    checks.bothProjectsActuallyRunning = true;
    checks.actualOwnedShellAndChild = true;
    const betaBefore = store.listEvents(beta.id);
    a.controller.abort();
    const aEvents = await a.done;
    assert.equal(aEvents.at(-1).reason.kind, 'aborted');
    await until(() => store.getTask(alpha.id).status === 'cancelled', 'A terminal cancelled');
    for (const pid of pids) await until(() => {
      try { process.kill(pid, 0); return false; } catch (error) { if (error.code === 'ESRCH') return true; throw error; }
    }, 'A actual shell and child exited');
    checks.onlyAProcessesExitAfterAbort = true;
    await delay(1000);
    if (otherShell) {
      for (const pid of betaPids) process.kill(pid, 0);
      assert.equal(parent(betaPids[1]), betaPids[0], 'B original direct child survives A cancellation');
      checks.bOriginalProcessesSurviveAStop = true;
    } else assert.equal(heldClosed, false, 'A abort must not close B live model response');
    assert.equal(b.controller.signal.aborted, false);
    assert.equal(store.getTask(beta.id).status, 'running');
    assert.deepEqual(store.listEvents(beta.id), betaBefore, 'A cancellation must not append or mutate B events');
    await assert.rejects(readFile(join(paths.A, 'late.txt')), { code: 'ENOENT' });
    await assert.rejects(readFile(join(paths.B, 'answer.txt')), { code: 'ENOENT' });
    checks[otherShell ? 'bToolAndEventsUnaffected' : 'bConnectionAndEventsUnaffected'] = true;
    const aFrozen = store.listEvents(alpha.id);
    assert.ok(!aFrozen.some(event => event.payload.member === 'verifier' || event.type === 'team_state' && event.payload.phase === 'summarizing'));
    if (otherShell) {
      // Nonblocking open fails promptly if the original FIFO reader disappeared.
      // Send data only: never signal/kill either B tool process to complete it.
      const fifo = await open(join(paths.B, 'release.fifo'), constants.O_WRONLY | constants.O_NONBLOCK);
      try { await fifo.writeFile('RELEASE_B\n'); } finally { await fifo.close(); }
    } else respond(heldResponse, 'write', { path: 'answer.txt', content: 'B_ONLY_42\n' });
    const bEvents = await b.done;
    assert.equal(bEvents.at(-1).reason.kind, 'stop');
    assert.ok(bEvents.some(event => event.text?.includes('PROJECT_B_DELIVERED')));
    assert.equal(store.getTask(beta.id).status, 'succeeded');
    assert.deepEqual(store.listEvents(alpha.id), aFrozen, 'B completion must not alter cancelled A history');
    assert.equal(await readFile(join(paths.A, 'answer.txt'), 'utf8'), 'A_ONLY_42\n');
    assert.equal(await readFile(join(paths.B, 'answer.txt'), 'utf8'), 'B_ONLY_42\n');
    await assert.rejects(readFile(join(paths.A, 'late.txt')), { code: 'ENOENT' });
    const betaEvents = store.listEvents(beta.id);
    for (const [member, toolName] of [['implementer', otherShell ? 'bash' : 'write'], ['verifier', 'read']]) {
      assert.ok(betaEvents.some(event => event.type === 'tool_end' && event.payload.member === member && event.payload.toolName === toolName && event.payload.isError === false));
    }
    assert.ok(betaEvents.some(event => event.type === 'team_state' && event.payload.phase === 'completed' && event.payload.outcome?.code === 'verified'));
    for (const task of [alpha, beta]) for (const event of store.listEvents(task.id)) {
      assert.equal(event.taskId, task.id); assert.equal(event.projectId, task.projectId); assert.equal(event.conversationId, task.conversationId);
      if (event.payload.teamId) assert.equal(event.payload.teamId, task.id);
    }
    if (otherShell) {
      assert.equal(await readFile(join(paths.B, 'release.txt'), 'utf8'), 'RELEASE_B\n');
      for (const pid of betaPids) await until(() => {
        try { process.kill(pid, 0); return false; } catch (error) { if (error.code === 'ESRCH') return true; throw error; }
      }, 'B original processes exited naturally after FIFO release');
      checks.bNaturalExitAfterDataRelease = true;
    }
    checks.bIndependentVerificationAndDelivery = true;
    checks.separateArtifactsAndEventOwnership = true;
    const ordinary = await start('A', 'ordinary').done;
    assert.equal(ordinary.at(-1).reason.kind, 'stop');
    assert.ok(ordinary.some(event => event.text?.includes('PROJECT_A_ORDINARY')));
    checks.aLeaseReusable = true;
    assert.deepEqual(errors, []);
    const saved = store.listTasks().slice().reverse();
    assert.deepEqual(saved.map(task => task.status), ['cancelled', 'succeeded', 'succeeded']);
    assert.deepEqual(saved.map(task => store.lastTaskEvent(task.id, 'task_submission').mode), ['team', 'team', 'ordinary']);
    return { scope: 'actual Host.apply -> PI adapter -> Scheduler -> real SDK; isolated synthetic data/model; no renderer or installed application',
      checks, requests: requests.length, statuses: saved.map(task => task.status), modes: ['team', 'team', 'ordinary'],
      otherProjectActivity: otherShell ? 'actual bash and direct cat FIFO reader' : 'held model response',
      postAbortObservationMs: 1000, childSleepSeconds: 120, normalGUI: false, externalModel: false, productionTouched: false };
  } finally {
    controllers.forEach(controller => controller.abort());
    try { for (const dispose of disposers.reverse()) await dispose?.(); }
    finally { store?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
}

for (const otherShell of [false, true]) test(`stopping a real team shell leaves another project ${otherShell ? 'actual shell and direct child' : 'model request'} and independent delivery intact`, { timeout: 45000 }, async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'muma-team-stop-isolation-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  const resources = process.env.MOOS_ELECTRON_TEST_DSH_CLI && resolve(dirname(process.env.MOOS_ELECTRON_TEST_DSH_CLI), '../..');
  const runtime = resources ? join(resources, 'pi-runtime') : join(root, 'pi-runtime');
  const plugin = resources ? join(resources, 'profile-template/profiles/web/node_modules/moos-electron-shell') : join(repo, 'apps/electron/plugin');
  if (!resources) {
    await symlink(repo, runtime);
    const adapterDir = join(root, 'host-runtime/dsh/moos-pi'); await mkdir(adapterDir, { recursive: true });
    for (const name of ['pi-route.js', 'pi-fork.js', 'pi-submission.js']) await cp(new URL('./plugin/' + name, import.meta.url), join(adapterDir, name));
  }
  const data = join(root, 'profile'); await mkdir(join(data, 'workspace'), { recursive: true });
  const env = { ...process.env, MOOS_ELECTRON_PI_RUNTIME: runtime, MOOS_ELECTRON_WORKSPACE_ROOT: join(data, 'workspace') };
  for (const key of ['MOOS_ELECTRON_PI_FIXTURE_MODE', 'MOOS_DESKTOP_HELPER', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE']) delete env[key];
  const script = `const result = await (${verify.toString()})(${JSON.stringify({ runtime, plugin, data, otherShell })}); console.log('TEAM_STOP_ISOLATION_RESULT ' + JSON.stringify(result));`;
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { env, timeout: 40000 });
  const result = JSON.parse(stdout.split('\n').find(line => line.startsWith('TEAM_STOP_ISOLATION_RESULT ')).slice('TEAM_STOP_ISOLATION_RESULT '.length));
  assert.ok(Object.values(result.checks).every(value => value === true));
  assert.equal(Object.keys(result.checks).length, otherShell ? 11 : 8);
  t.diagnostic('TEAM_STOP_ISOLATION_RESULT ' + JSON.stringify({ ...result, packagedRuntime: Boolean(resources) }));
});
