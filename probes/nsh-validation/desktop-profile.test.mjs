import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmod, lstat, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { Store } from '../../services/agent/store.mjs';
import { startDesktopHost } from './desktop-host.mjs';

async function profile(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'n01-profile-test-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function call(host, method, params = {}) {
  return host.call({ id: 'x', version: 1, method, params });
}

test('synthetic profile fails closed on concurrent ownership, stale lease, missing DB and redirected workspace', async t => {
  const root = await profile(t);
  const start = () => startDesktopHost({ profileDir: root });
  const host = await start();
  t.after(() => host.close());
  await assert.rejects(start, /locked/);
  await host.close();
  const db = join(root, 'data', 'desktop.sqlite');
  assert.equal((await lstat(db)).mode & 0o777, 0o600);
  await chmod(root, 0o755);
  await assert.rejects(start, /Invalid isolated desktop profile/);
  await chmod(root, 0o700);
  const lock = join(root, '.n01-active');
  await writeFile(lock, '', { mode: 0o600 });
  await assert.rejects(start, /locked/);
  assert.equal((await lstat(lock)).isFile(), true);
  await rm(lock);
  await rename(db, db + '.saved');
  await assert.rejects(start, { code: 'ENOENT' });
  await assert.rejects(lstat(db), { code: 'ENOENT' });
  await symlink(db + '.saved', db);
  await assert.rejects(start, /Invalid isolated desktop profile/);
  await rm(db);
  await rename(db + '.saved', db);
  const workspace = host.trustedProjects[0].path;
  await rename(workspace, workspace + '.saved');
  await symlink(workspace + '.saved', workspace);
  await assert.rejects(start, /Invalid isolated desktop profile/);
  assert.equal((await lstat(workspace)).isSymbolicLink(), true);
});

test('real PI against loopback: separate Host processes preserve IDs, history and workspace; new turn sees prior context', { timeout: 45000 }, async t => {
  const root = await profile(t);
  const received = [];
  const http = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const b of req) chunks.push(b);
      const m = JSON.parse(Buffer.concat(chunks).toString()).messages;
      received.push(m);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const respond = (delta, finish_reason) => res.write(`data: ${JSON.stringify({ id: 'synthetic', model: 'fixture',
        choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
      respond({ role: 'assistant', content: received.length === 1 ? 'PRIMARY_ASSISTANT_MARKER' : 'CONTINUATION_MARKER' }, null);
      respond({}, 'stop');
      res.end('data: [DONE]\n\n');
    } catch { res.destroy(); }
  });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  t.after(() => { http.closeAllConnections(); return new Promise(resolve => http.close(resolve)); });
  const script = `
    import { startDesktopHost } from ${JSON.stringify(new URL('./desktop-host.mjs', import.meta.url).href)};
    import { serveDesktopPipe } from ${JSON.stringify(new URL('./desktop-host-stdio.mjs', import.meta.url).href)};
    process.umask(0o077);
    const host = await startDesktopHost({ profileDir: process.argv[1], liveModels: {
      catalog: { options: [{ id: 'fixture', label: 'Loopback' }], defaultId: 'fixture' },
      routes: new Map([['fixture', { apiKey: 'synthetic-probe-only', provider: { id: 'fixture', name: 'Loopback',
        baseUrl: process.argv[2], model: 'fixture', api: 'openai-completions', contextWindow: 64000, maxTokens: 1024 } }]])
    } });
    if ((await serveDesktopPipe({ start: async () => host })).failed) process.exitCode = 1;`;
  function launch() {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', script, root, `http://127.0.0.1:${http.address().port}/v1`],
      { env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8', TMPDIR: root, HOME: root } });
    t.after(() => { if (child.exitCode === null && !child.signalCode) child.kill(); });
    const closed = once(child, 'close');
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', s => { stderr += s; });
    const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
    let seq = 0;
    return {
      async call(method, params = {}) {
        const id = `req-${++seq}`;
        child.stdin.write(JSON.stringify({ id, method, params, version: 1 }) + '\n');
        const { value } = await lines.next();
        assert.ok(value, stderr);
        const response = JSON.parse(value);
        assert.equal(response.id, id);
        return response;
      },
      async close() {
        child.stdin.end();
        assert.deepEqual(await closed, [0, null], stderr);
        assert.doesNotMatch(stderr, /synthetic-probe-only/);
      },
    };
  }
  async function submit(client, scope, requestId, text) {
    const r = await client.call('tasks.submit', { ...scope, requestId, text });
    assert.equal(r.ok, true);
    const taskId = r.result.task.id;
    const until = Date.now() + 15000;
    while (Date.now() < until) {
      const { result } = await client.call('tasks.events', { ...scope, taskId, cursor: null, limit: 100 });
      if (result?.terminal && !result.hasMore) {
        assert.equal(result.task.status, 'succeeded');
        return { taskId, text: result.events.filter(e => e.type === 'text_delta').map(e => e.payload.delta).join('') };
      }
      await delay(30);
    }
    assert.fail('turn not fully drained');
  }
  const first = launch();
  const projects = (await first.call('projects.list')).result.projects;
  const { id: projectId } = projects[0];
  const { session } = (await first.call('sessions.create', { projectId, title: '重启续聊验证' })).result;
  const scope = { projectId, sessionId: session.id };
  const before = await submit(first, scope, 'initial', 'PRIMARY_USER_MARKER');
  assert.equal(before.text, 'PRIMARY_ASSISTANT_MARKER');
  const workspace = join(root, 'workspace-0', 'retained.txt');
  await writeFile(workspace, 'synthetic persistent workspace\n');
  await first.close();
  await assert.rejects(lstat(join(root, '.n01-active')), { code: 'ENOENT' });
  const dbPath = join(root, 'data', 'desktop.sqlite');
  let db = new Store({ dbPath });
  const old = db.listMessages(session.id);
  assert.deepEqual(old.map(m => m.content), ['PRIMARY_USER_MARKER', 'PRIMARY_ASSISTANT_MARKER']);
  const unfinished = db.createTask({ conversationId: session.id, message: 'NEVER_REPLAY', timeoutMs: 600000 });
  db.updateTask(unfinished.id, { status: 'running' });
  db.close();
  const second = launch();
  assert.deepEqual((await second.call('projects.list')).result.projects, projects);
  assert.ok((await second.call('sessions.list', { projectId })).result.sessions.some(s => JSON.stringify(s) === JSON.stringify(session)));
  assert.deepEqual((await second.call('tasks.events', { ...scope, taskId: before.taskId, cursor: null, limit: 100 })).error, { code: 'not_found' });
  assert.equal(received.length, 1);
  assert.equal(await readFile(workspace, 'utf8'), 'synthetic persistent workspace\n');
  assert.equal((await submit(second, scope, 'next', 'CONTINUE_THIS_THREAD')).text, 'CONTINUATION_MARKER');
  await second.close();
  assert.equal(received.length, 2);
  assert.match(JSON.stringify(received[1]), /PRIMARY_USER_MARKER/);
  assert.match(JSON.stringify(received[1]), /PRIMARY_ASSISTANT_MARKER/);
  assert.doesNotMatch(JSON.stringify(received[1]), /NEVER_REPLAY/);
  db = new Store({ dbPath });
  try {
    assert.deepEqual(db.listMessages(session.id).slice(0, old.length), old);
    assert.equal(db.getTask(unfinished.id).status, 'interrupted');
    assert.equal(db.getTask(unfinished.id).errorCode, 'host_interrupted');
  } finally { db.close(); }
});

test('fixed disposable Host cannot opt into a persisted profile via RPC', async t => {
  const root = await profile(t);
  const host = await startDesktopHost();
  t.after(() => host.close());
  assert.equal(call(host, 'projects.list', { profileDir: root }).error.code, 'invalid_request');
  assert.equal(call(host, 'profiles.import', { profileDir: root }).error.code, 'unsupported_method');
  await assert.rejects(lstat(join(root, 'data')), { code: 'ENOENT' });
});
