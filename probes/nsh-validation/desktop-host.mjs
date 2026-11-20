/** N01 trusted desktop launch layer. No listener, UI paths or renderer credentials. */
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../services/agent/store.mjs';
import { Scheduler } from '../../services/agent/scheduler.mjs';
import { TaskFailure } from '../../services/agent/errors.mjs';
import { runPiSdk } from '../../packages/pi-runtime/sdk-runtime.mjs';
import { desktopFixtureModels, startDesktopModelFixture } from './desktop-model-fixture.mjs';

import { desktopTaskStatistics } from './desktop-statistics.mjs';
import { leaseDesktopProfile, verifyProfileEntry } from './desktop-profile.mjs';

const terminal = new Set(['succeeded', 'failed', 'cancelled', 'interrupted']);
const token = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
class Rejected extends Error { constructor(code) { super(code); this.code = code; } }
const reject = code => { throw new Rejected(code); };
function exact(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) reject('invalid_request');
}
function title(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 100 || /[\x00-\x1f\x7f]/.test(value)) reject('invalid_request');
  return value;
}
const taskView = task => ({ id: task.id, projectId: task.projectId, sessionId: task.conversationId,
  status: task.status, errorCode: task.errorCode });
function publicPayload(type, payload) {
  if (type === 'task_state') return { status: payload.status, errorCode: payload.errorCode ?? null };
  if (type === 'text_delta' && typeof payload.delta === 'string') return { delta: payload.delta.slice(0, 4096), truncated: payload.delta.length > 4096 };
  if (['tool_start', 'tool_end'].includes(type)) return {
    toolCallId: String(payload.toolCallId ?? '').slice(0, 200),
    toolName: ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls'].includes(payload.toolName) ? payload.toolName : 'other',
    ...(type === 'tool_end' ? { isError: payload.isError === true } : {}),
  };
}

/** Only trusted native code may construct this object. run is a test seam, never an RPC parameter.
 * Projects are created/realpathed here, not supplied by TSX. Fixed entrypoints remain disposable;
 * the trusted profileDir seam is only for testing candidate-owned persistence.
 * Keep trustedProjects and close outside the renderer; expose only call via a private pipe.
 */
export async function startDesktopHost({ projectNames = ['Desktop A', 'Desktop B'], run = runPiSdk, liveModels, profileDir } = {}) {
  if (!Array.isArray(projectNames) || projectNames.length < 1 || projectNames.length > 8) throw new Error('Invalid trusted registry');
  projectNames.forEach(title);
  const lease = profileDir === undefined ? null : await leaseDesktopProfile(profileDir);
  const root = lease ? profileDir : await mkdtemp(join(tmpdir(), 'muma-n01-desktop-'));
  const fresh = lease?.fresh ?? true;
  const release = () => lease ? lease.close() : rm(root, { recursive: true, force: true });
  let store, fixture, scheduler, closing, closed = false;
  const journals = new Map(), requests = new Map(), trustedProjects = [];
  try {
    const dataDir = join(root, 'data');
    const dbPath = join(dataDir, 'desktop.sqlite');
    if (fresh) {
      await mkdir(dataDir, { mode: 0o700 });
      if (lease) await writeFile(dbPath, '', { flag: 'wx', mode: 0o600 });
    } else {
      await verifyProfileEntry(dataDir, true);
      if (!(await verifyProfileEntry(dbPath, false)).size) throw new Error('Missing isolated desktop database');
      for (const suffix of ['-wal', '-shm']) {
        try { await verifyProfileEntry(dbPath + suffix, false); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
    store = new Store({ dbPath });
    const saved = store.listProjects();
    if (!fresh && saved.length !== projectNames.length) throw new Error('Invalid isolated desktop project registry');
    for (const [index, name] of projectNames.entries()) {
      const workspaceLabel = `workspace-${index}`;
      const path = join(root, workspaceLabel);
      if (fresh) await mkdir(path, { mode: 0o700 });
      else await verifyProfileEntry(path, true);
      const project = fresh ? await store.addProject(await realpath(path)) : saved[index];
      if (!fresh && (project.path !== path || !store.listConversations(project.id).length)) {
        throw new Error('Invalid isolated desktop project registry');
      }
      trustedProjects.push({ id: project.id, name, path: project.path, workspaceLabel });
      if (fresh) store.createConversation(project.id, '新会话');
    }
    if (!fresh) store.interruptUnfinished();
    if (!liveModels) fixture = await startDesktopModelFixture();
    const catalog = liveModels?.catalog ?? { options: desktopFixtureModels, defaultId: desktopFixtureModels[0].id };
    scheduler = new Scheduler({ store, concurrency: 2, run: async options => {
      const { modelId, reasoningEffort } = journals.get(options.task.id);
      const entry = liveModels ? liveModels.routes.get(modelId) : { apiKey: fixture.apiKey,
        provider: { id: 'n01-desktop-fixture', name: 'Desktop local fixture', baseUrl: fixture.baseUrl,
          model: modelId, api: 'openai-completions', contextWindow: 64000, maxTokens: 2048 } };
      try { return await run({ ...options, task: { ...options.task, text: options.task.message },
        provider: { ...entry.provider, thinkingLevel: reasoningEffort ?? 'off' }, apiKey: entry.apiKey, dataDir, imageGen: null,
        permissions: { getMode: () => 'workspace-write' },
        sessionPolicy: { allowedTools: liveModels ? ['read', 'write', 'edit', 'ls', 'bash'] : ['read', 'write', 'bash'] } }); }
      catch (error) {
        if (options.signal.aborted) throw new TaskFailure('cancelled');
        // Preserve only known, sanitized PI failure codes; never forward an upstream error body.
        if (liveModels && error instanceof TaskFailure) throw new TaskFailure(error.code);
        throw new TaskFailure('internal');
      }
    }, onEvent: event => {
      const journal = journals.get(event.taskId);
      journal.statistics.observe(event);
      const payload = publicPayload(event.type, event.payload);
      if (!payload) return;
      const item = { sequence: ++journal.last, type: event.type, payload };
      const bytes = Buffer.byteLength(JSON.stringify(item));
      journal.events.push({ item, bytes }); journal.bytes += bytes;
      while (journal.events.length > 4096 || journal.bytes > 1024 * 1024) {
        const removed = journal.events.shift(); journal.bytes -= removed.bytes; journal.floor = removed.item.sequence;
      }
    } });
    function project(id) {
      const found = trustedProjects.find(p => p.id === id); if (!found) reject('not_found'); return found;
    }
    function session(projectId, sessionId) {
      project(projectId);
      let found; try { found = store.getConversation(sessionId); } catch { reject('not_found'); }
      if (found.projectId !== projectId) reject('not_found'); return found;
    }
    function task(params) {
      session(params.projectId, params.sessionId);
      let found; try { found = store.getTask(params.taskId); } catch { reject('not_found'); }
      if (found.projectId !== params.projectId || found.conversationId !== params.sessionId || !journals.has(found.id)) reject('not_found'); return found;
    }
    function sessionView(s, trusted) {
      return { id: s.id, projectId: s.projectId, title: s.title,
        preview: { workspaceLabel: trusted.workspaceLabel, createdAt: s.createdAt } };
    }
    function dispatch(method, p) {
      switch (method) {
        case 'projects.list': exact(p, []); return {
          projects: trustedProjects.map(({ id, name }) => ({ id, name })),
          models: catalog,
        };
        case 'sessions.list': {
          exact(p, ['projectId']); const trusted = project(p.projectId);
          return { sessions: store.listConversations(p.projectId).map(s => sessionView(s, trusted)) };
        }
        case 'sessions.create': {
          exact(p, ['projectId', 'title']); const trusted = project(p.projectId); title(p.title);
          if (store.listConversations(p.projectId).length >= 16) reject('limit');
          return { session: sessionView(store.createConversation(p.projectId, p.title), trusted) };
        }
        case 'tasks.submit': {
          const explicit = p && Object.hasOwn(p, 'modelId');
          const explicitEffort = p && Object.hasOwn(p, 'reasoningEffort');
          exact(p, ['projectId', 'sessionId', 'requestId', 'text', ...(explicit ? ['modelId'] : []), ...(explicitEffort ? ['reasoningEffort'] : [])]);
          session(p.projectId, p.sessionId);
          const modelId = explicit ? p.modelId : catalog.defaultId;
          const model = catalog.options.find(m => m.id === modelId);
          if (!model) reject('invalid_request');
          if (explicitEffort && !model.reasoning?.levels.some(e => e.id === p.reasoningEffort)) reject('invalid_request');
          const reasoningEffort = explicitEffort ? p.reasoningEffort : model.reasoning?.defaultId;
          if (!token(p.requestId) || typeof p.text !== 'string' || !p.text.trim() || Buffer.byteLength(p.text) > 4096 || p.text.includes('\x00')) reject('invalid_request');
          const key = `${p.sessionId}:${p.requestId}`, prior = requests.get(key);
          if (prior) {
            const admitted = journals.get(prior.id);
            if (prior.text !== p.text || admitted.modelId !== modelId || admitted.reasoningEffort !== reasoningEffort) reject('conflict');
            return { task: taskView(store.getTask(prior.id)), replayed: true };
          }
          if (requests.size >= 32) reject('limit');
          const created = scheduler.submit({ conversationId: p.sessionId, message: p.text, timeoutMs: 600000,
            onCreate: t => journals.set(t.id, { modelId, reasoningEffort, events: [], last: 0, floor: 0, bytes: 0, statistics: desktopTaskStatistics() }) });
          requests.set(key, { id: created.id, text: p.text });
          return { task: taskView(created), replayed: false };
        }
        case 'tasks.cancel': exact(p, ['projectId', 'sessionId', 'taskId']); task(p);
          return { task: taskView(scheduler.cancel(p.taskId)) };
        case 'tasks.events': {
          exact(p, ['projectId', 'sessionId', 'taskId', 'cursor', 'limit']); const found = task(p);
          if (!Number.isSafeInteger(p.limit) || p.limit < 1 || p.limit > 100) reject('invalid_request');
          let after = 0;
          if (p.cursor !== null) {
            if (typeof p.cursor !== 'string' || p.cursor.length > 64 || !p.cursor.startsWith(`${found.id}:`)) reject('invalid_cursor');
            const value = p.cursor.slice(found.id.length + 1);
            if (!/^(0|[1-9][0-9]{0,9})$/.test(value)) reject('invalid_cursor'); after = Number(value);
          }
          const journal = journals.get(found.id);
          if (after < journal.floor) reject('cursor_expired');
          if (after > journal.last) reject('invalid_cursor');
          const events = []; let bytes = 0;
          for (const { item, bytes: size } of journal.events) {
            if (item.sequence <= after) continue;
            if (events.length >= p.limit || bytes + size > 64 * 1024) break;
            events.push(item); bytes += size;
          }
          const next = events.at(-1)?.sequence ?? after;
          const hasMore = next < journal.last, ended = terminal.has(found.status);
          return { task: taskView(found), terminal: ended, events,
            cursor: `${found.id}:${next}`, hasMore,
            ...(ended && !hasMore ? { statistics: journal.statistics.snapshot() } : {}) };
        }
        default: reject('unsupported_method');
      }
    }
    // Synchronous admission: no await between idempotency lookup and task creation.
    function call(input) {
      try {
        exact(input, ['version', 'id', 'method', 'params']);
        if (input.version !== 1 || !token(input.id) || typeof input.method !== 'string') reject('invalid_request');
        if (closed) reject('closed');
        return { version: 1, id: input.id, ok: true, result: dispatch(input.method, input.params) };
      } catch (error) {
        return { version: 1, id: token(input?.id) ? input.id : null, ok: false,
          error: { code: error instanceof Rejected ? error.code : 'internal' } };
      }
    }
    async function close() {
      closed = true;
      if (!closing) closing = (async () => {
        const drained = await scheduler.shutdown({ timeoutMs: 15000 });
        if (!drained.drained) throw new Error('Desktop drain incomplete; state retained');
        await fixture?.close(); store.close(); await release();
      })();
      return closing;
    }
    await lease?.ready();
    return { call, close, trustedProjects };
  } catch (error) {
    const drained = await scheduler?.shutdown({ timeoutMs: 15000 });
    if (!drained || drained.drained) { await fixture?.close(); store?.close(); await release(); }
    throw error;
  }
}
