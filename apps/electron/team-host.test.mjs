import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Actual production Host.apply -> PI route -> Scheduler -> team runner -> real
// SDK tools, using synthetic local model/data only. No installed app or GUI.
test('production Host dispatches mode snapshots to real PI team sessions without restoring DSH executors', { timeout: 30000 }, async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'muma-team-host-')));
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  const resources = process.env.MOOS_ELECTRON_TEST_DSH_CLI &&
    resolve(dirname(process.env.MOOS_ELECTRON_TEST_DSH_CLI), '../..');
  const runtime = resources ? join(resources, 'pi-runtime') : join(root, 'pi-runtime');
  const plugin = resources ? join(resources, 'profile-template/profiles/web/node_modules/moos-electron-shell') : join(repo, 'apps/electron/plugin');
  if (!resources) {
    await symlink(repo, runtime);
    const adapterDir = join(root, 'host-runtime/dsh/moos-pi');
    await mkdir(adapterDir, { recursive: true });
    for (const name of ['pi-route.js', 'pi-fork.js', 'pi-submission.js']) {
      await cp(new URL('./plugin/' + name, import.meta.url), join(adapterDir, name));
    }
    const routed = await readFile(new URL('./plugin/pi-route.js', import.meta.url), 'utf8');
    for (const code of ['verification_rejected', 'verification_incomplete', 'tool_error']) {
      assert.ok(routed.includes(code), `team failure ${code} must map to a truthful turn failure, not the INTERNAL fallback`);
    }
  }
  const data = join(root, 'profile');
  const workspace = join(data, 'workspace');
  await mkdir(workspace, { recursive: true });
  const requests = [], errors = [];
  const plan = { tasks: [
    { id: 'build', role: 'implementer', goal: 'Write answer.txt containing 42', dependsOn: [] },
    { id: 'check', role: 'verifier', goal: 'Read answer.txt to verify 42', dependsOn: ['build'] },
  ] };
  const server = createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw); requests.push(body);
      const user = body.messages.filter(item => item.role === 'user').at(-1);
      const prompt = typeof user.content === 'string' ? user.content : user.content.map(part => part.text ?? '').join('');
      const names = body.tools?.map(item => item.function.name) ?? [];
      const latest = body.messages.at(-1).role === 'tool' ? body.messages.at(-1) : undefined;
      let name, args, content;
      if (prompt.includes('只根据已有工具/成员证据')) {
        assert.deepEqual(names, []); content = 'TEAM_HOST_DELIVERED_42';
      } else if (names.includes('team_plan')) {
        assert.deepEqual(names.slice().sort(), ['ls', 'read', 'team_plan']);
        if (latest) content = 'planned'; else { name = 'team_plan'; args = plan; }
      } else if (names.includes('team_verdict')) {
        if (!latest) { name = 'read'; args = { path: 'answer.txt' }; }
        else if (latest.name === 'read' || latest.content.includes('42')) {
          assert.ok(latest.content.includes('42'));
          name = 'team_verdict'; args = { passed: true, summary: 'Independent read returned 42' };
        } else content = 'verified';
      } else if (prompt.includes('当前任务build')) {
        if (latest) content = 'written'; else { name = 'write'; args = { path: 'answer.txt', content: '42\n' }; }
      } else content = 'ORDINARY_HOST_REPLY';
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const delta = name ? { tool_calls: [{ index: 0, id: 'call-' + requests.length, type: 'function',
        function: { name, arguments: JSON.stringify(args) } }] } : { content };
      for (const [part, finish] of [[delta, null], [{}, name ? 'tool_calls' : 'stop']]) {
        res.write('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: part, finish_reason: finish }] }) + '\n\n');
      }
      res.end('data: [DONE]\n\n');
    } catch (error) { errors.push(error); res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); server.close(); await rm(root, { recursive: true, force: true }); });
  const env = { ...process.env, MOOS_ELECTRON_PI_RUNTIME: runtime, MOOS_ELECTRON_WORKSPACE_ROOT: workspace };
  for (const key of ['MOOS_ELECTRON_PI_FIXTURE_MODE', 'MOOS_DESKTOP_HELPER', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE']) delete env[key];
  const script = `
    import assert from 'node:assert/strict';
    import { randomUUID } from 'node:crypto';
    import { apply } from ${JSON.stringify(pathToFileURL(join(plugin, 'host.js')).href)};
    import { piModels } from ${JSON.stringify(pathToFileURL(join(plugin, 'pi-models.js')).href)};
    import { checkedProvider } from ${JSON.stringify(pathToFileURL(join(runtime, 'packages/pi-adapter/index.mjs')).href)};
    import { Store } from ${JSON.stringify(pathToFileURL(join(runtime, 'services/agent/store.mjs')).href)};
    const data = ${JSON.stringify(data)}, cwd = ${JSON.stringify(workspace)};
    const models = piModels(data, checkedProvider);
    await models.save({ id: 'local', model: 'fixture-model', api: 'openai-completions',
      baseUrl: ${JSON.stringify(`http://127.0.0.1:${server.address().port}/v1`)}, apiKey: 'synthetic-local-only' });
    const disposers = []; let adapter, executor, seq = 0;
    const session = { id: 'host-team', header: { cwd } };
    const ctx = {
      effect(setup) { disposers.push(setup()); },
      tools: { setExecutor(value) { executor = value; return () => {}; } },
      agents: { get: () => ({ session }), turnBoundaryOf: () => ({ openTurnStartSeq: ++seq }) },
      llm: { registerAdapter(_routes, value) { adapter = value; return () => {}; } },
      sandboxPolicy: { resolve: () => ({ mode: 'workspace-write' }) },
      approval: { request: () => { throw new Error('Unexpected approval'); } },
      on(event, fn) { if (event === 'dispose') disposers.push(fn); }, emit() {},
    };
    await apply(ctx);
    try {
      assert.deepEqual(executor.describe(), { schemas: [], knownNames: [] });
      await assert.rejects(executor.execute(), /由 PI 执行/);
      for (const mode of ['team', 'ordinary']) {
        const events = [];
        for await (const event of adapter.stream({ sessionId: session.id, model: 'local', messages: [{
          role: 'user', source: { kind: 'user', rpcId: 'moos-pi-mode:v1:' + mode + ':' + randomUUID() },
          content: [{ type: 'text', text: mode === 'team' ? 'Produce answer.txt with 42 and independently verify it' : 'hello' }],
        }] })) events.push(event);
        assert.equal(events.at(-1).reason.kind, 'stop', JSON.stringify(events.at(-1)));
        assert.ok(events.some(event => event.text?.includes(mode === 'team' ? 'TEAM_HOST_DELIVERED_42' : 'ORDINARY_HOST_REPLY')));
      }
    } finally { for (const dispose of disposers.reverse()) await dispose?.(); }
    const store = new Store({ dbPath: data + '/pi/moos.sqlite' });
    try {
      const tasks = store.listTasks();
      assert.equal(tasks.length, 2);
      assert.ok(tasks.every(task => task.status === 'succeeded'));
      assert.deepEqual(tasks.map(task => store.lastTaskEvent(task.id, 'task_submission').mode), ['ordinary', 'team']);
      const team = tasks[1];
      const events = store.listEvents(team.id);
      assert.ok(events.some(event => event.type === 'team_state' && event.payload.phase === 'succeeded'));
      for (const [member, tool] of [['implementer', 'write'], ['verifier', 'read']]) {
        assert.ok(events.some(event => event.type === 'tool_end' && event.payload.member === member && event.payload.toolName === tool));
      }
    } finally { store.close(); }
  `;
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { env, timeout: 25000 });
  assert.deepEqual(errors, []);
  assert.equal(await readFile(join(workspace, 'answer.txt'), 'utf8'), '42\n');
  assert.equal((await readdir(join(data, 'pi/sessions'))).filter(name => name.startsWith('team-')).length, 3);
  assert.ok(requests.length >= 8);
});
