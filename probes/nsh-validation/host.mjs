/** N01 pre-phone host checkpoint. Loopback-only TLS; never a production/LAN server. */
import { createServer } from 'node:https';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../services/agent/store.mjs';
import { Scheduler } from '../../services/agent/scheduler.mjs';
import { runPiSdk } from '../../packages/pi-runtime/sdk-runtime.mjs';
import { startFixture } from '../../services/agent/fixture.mjs';

const BODY_LIMIT = 4096;
const TASK_LIMIT = 32;
const scenarios = Object.freeze({ write: 'MOOS_FIXTURE_WRITE N01_OK', hold: 'MOOS_FIXTURE_HOLD' });
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'interrupted']);
class ProtocolError extends Error {
  constructor(status) { super('Validation request rejected'); this.status = status; }
}
function reject(status) { throw new ProtocolError(status); }
function equal(a, b) {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function exact(object, keys) {
  if (!object || typeof object !== 'object' || Array.isArray(object)
    || Object.keys(object).sort().join(',') !== keys.slice().sort().join(',')) reject(400);
}
async function body(req) {
  if (req.headers['content-type'] !== 'application/json') reject(415);
  if (Number(req.headers['content-length']) > BODY_LIMIT) reject(413);
  let size = 0; const chunks = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length; if (size > BODY_LIMIT) reject(413); chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { reject(400); }
}

/** Owns disposable temp state only. tls is caller-provided key/cert; no global trust changes.
 * Returns ephemeral test-client tokens in memory, never prints them or model credentials.
 * This is NOT QR pairing, a mobile TLS solution, OS sandboxing or a public task service.
 */
export async function startValidationHost({ tls, run = runPiSdk } = {}) {
  if (!tls?.key || !tls?.cert) throw new Error('Explicit validation TLS key/cert required');
  const root = await mkdtemp(join(tmpdir(), 'muma-n01-host-'));
  let fixture, store, scheduler, server;
  const clients = []; const pending = new Map(); let closing;
  try {
    fixture = await startFixture();
    const dataDir = join(root, 'data'); await mkdir(dataDir, { mode: 0o700 });
    store = new Store({ dbPath: join(dataDir, 'host.sqlite') });
    const provider = { id: 'n01-fixture', name: 'N01 local model fixture', baseUrl: fixture.baseUrl,
      model: 'fixture', api: 'openai-completions', contextWindow: 32000, maxTokens: 2048 };
    scheduler = new Scheduler({ store, concurrency: 2, heartbeatMs: 100,
      run: options => run({ ...options, task: { ...options.task, text: options.task.message },
        provider, apiKey: fixture.apiKey, dataDir, imageGen: null }) });
    // Two test principals, each with exactly one disposable project/conversation.
    // No request may add arbitrary paths, select providers, submit shell or use desktop tools.
    for (let i = 0; i < 2; i++) {
      const path = join(root, `project-${i}`); await mkdir(path, { mode: 0o700 });
      const project = await store.addProject(path);
      const conversation = store.createConversation(project.id, `N01 client ${i}`);
      clients.push({ token: randomBytes(32).toString('hex'), conversationId: conversation.id, path });
    }
    async function request(req) {
      if (closing) reject(503);
      if (req.headers.origin || req.headers['sec-fetch-site'] === 'cross-site') reject(403);
      const authorization = req.headers.authorization ?? '';
      const client = clients.find(item => equal(authorization, `Bearer ${item.token}`));
      if (!client) reject(401);
      if (req.method === 'POST' && req.url === '/v1/tasks') {
        const input = await body(req); exact(input, ['requestId', 'scenario']);
        if (typeof input.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.requestId)
          || typeof input.scenario !== 'string' || !Object.hasOwn(scenarios, input.scenario)) reject(400);
        const key = `${client.conversationId}:${input.requestId}`;
        const prior = pending.get(key);
        if (prior) {
          if (prior.scenario !== input.scenario) reject(409);
          return { task: store.getTask(prior.id), replayed: true };
        }
        if (pending.size >= TASK_LIMIT) reject(429);
        const task = scheduler.submit({ conversationId: client.conversationId,
          message: scenarios[input.scenario], timeoutMs: 600000 });
        pending.set(key, { id: task.id, scenario: input.scenario });
        return { task, replayed: false };
      }
      const match = /^\/v1\/tasks\/([a-f0-9-]{36})(?:\?after=(0|[1-9][0-9]{0,14}))?$/.exec(req.url);
      const cancel = /^\/v1\/tasks\/([a-f0-9-]{36})\/cancel$/.exec(req.url);
      const id = match?.[1] ?? cancel?.[1];
      if (!id) reject(404);
      let task;
      try { task = store.getTask(id); } catch { reject(404); }
      if (task.conversationId !== client.conversationId) reject(404);
      if (req.method === 'POST' && cancel) {
        exact(await body(req), []);
        return { task: scheduler.cancel(id) };
      }
      if (req.method === 'GET' && match) {
        const events = store.listEvents(id, Number(match[2] ?? 0));
        const page = events.slice(0, 100);
        return { task, terminal: terminal.has(task.status), events: page,
          cursor: page.at(-1)?.id ?? Number(match[2] ?? 0), hasMore: events.length > page.length };
      }
      reject(404);
    }
    server = createServer({ key: tls.key, cert: tls.cert, minVersion: 'TLSv1.2' }, (req, res) => {
      const send = (status, value) => {
        if (res.destroyed) return;
        res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store',
          'x-content-type-options': 'nosniff', connection: 'close' });
        res.end(JSON.stringify(value)); req.resume();
      };
      req.on('error', () => {}); res.on('error', () => {});
      void request(req).then(value => send(200, { version: 1, ...value }),
        error => send(error instanceof ProtocolError ? error.status : 500,
          { version: 1, error: 'Validation request rejected' }));
    });
    server.requestTimeout = 10000; server.headersTimeout = 5000;
    await new Promise((resolve, reject) => {
      server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
    });
    async function close() {
      if (!closing) closing = (async () => {
        // Stop accepting first, then drain PI and its task subprocesses before removing state.
        const stopped = new Promise(resolve => server.close(resolve)); server.closeAllConnections();
        const drained = await scheduler.shutdown({ timeoutMs: 15000 });
        await stopped;
        if (!drained.drained) throw new Error('Validation host drain incomplete; state retained');
        await fixture.close(); store.close(); await rm(root, { recursive: true, force: true });
      })();
      return closing;
    }
    return { url: `https://127.0.0.1:${server.address().port}`, clients,
      address: server.address(), close };
  } catch (error) {
    server?.closeAllConnections(); server?.close();
    await scheduler?.shutdown({ timeoutMs: 15000 }); await fixture?.close(); store?.close();
    await rm(root, { recursive: true, force: true }); throw error;
  }
}
