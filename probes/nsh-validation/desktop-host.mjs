/** N01 trusted desktop launch layer. No listener, UI paths or renderer credentials. */
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../services/agent/store.mjs';
import { Scheduler } from '../../services/agent/scheduler.mjs';
import { TaskFailure } from '../../services/agent/errors.mjs';
import { desktopFixtureModels, startDesktopModelFixture } from './desktop-model-fixture.mjs';

import { desktopTaskStatistics } from './desktop-statistics.mjs';
import { openDesktopHistory } from './desktop-history.mjs';
import { leaseDesktopProfile, verifyProfileEntry } from './desktop-profile.mjs';
import { readDesktopGoal, saveDesktopGoal, desktopGoalView, runDesktopTeamGoal } from './desktop-team-goal.mjs';

import { desktopModelServices } from './desktop-model-services.mjs';
import { openImportedHistory } from './desktop-imported-history.mjs';
import { desktopImages } from './desktop-images.mjs';
import { withWorkspaceChanges } from '../../apps/electron/plugin/pi-workspace-changes.js';

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

async function runDesktopPi(options) {
  options.signal.throwIfAborted();
  // Project and history reads need SQLite, but not the model SDK or its providers.
  const { runPiSdk } = await import('../../packages/pi-runtime/sdk-runtime.mjs');
  options.signal.throwIfAborted();
  return runPiSdk(options);
}
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
 * Projects are created/realpathed here, not supplied by TSX. Only the fixed synthetic
 * persistence probe sets profileDir; the regular fixture and live entries stay disposable.
 * Keep trustedProjects and close outside the renderer; expose only call via a private pipe.
 */
export async function startDesktopHost({ projectNames = ['Desktop A', 'Desktop B'], run = runDesktopPi, liveModels, profileDir } = {}) {
  if (!Array.isArray(projectNames) || projectNames.length < 1 || projectNames.length > 8) throw new Error('Invalid trusted registry');
  projectNames.forEach(title);
  const lease = profileDir === undefined ? null : await leaseDesktopProfile(profileDir);
  const root = lease ? profileDir : await mkdtemp(join(tmpdir(), 'muma-n01-desktop-'));
  const fresh = lease?.fresh ?? true;
  const release = () => lease ? lease.close() : rm(root, { recursive: true, force: true });
  let store, history, imported, fixture, scheduler, closing, closed = false;
  const journals = new Map(), requests = new Map(), trustedProjects = [];
  const attachments = desktopImages(reject);
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
    if (lease && !liveModels) {
      history = openDesktopHistory(dbPath);
      imported = await openImportedHistory(root);
    }
    const importedProject = imported && (trustedProjects.find(p => p.id === store.getSetting('desktop.imported.project')) ?? trustedProjects[0]);
    const importedSessions = imported?.list() ?? [];
    function historicalSessions(projectId, archived) {
      return projectId === importedProject?.id ? { imported: importedSessions.filter(s => Boolean(s.archived) === archived) } : {};
    }
    if (!liveModels) fixture = await startDesktopModelFixture({ restartCheck: !!lease });
    const catalog = liveModels?.catalog ?? { options: desktopFixtureModels, defaultId: desktopFixtureModels[0].id };
    const modelServices = history && desktopModelServices(root, desktopFixtureModels);
    const directory = () => modelServices ? modelServices.catalog() : catalog;
    const metadata = id => JSON.parse(store.getSetting(`desktop.session.${id}`) ?? '{}');
    const saveMetadata = (id, value) => store.setSetting(`desktop.session.${id}`, JSON.stringify(value));
    function sessionList(projectId, trusted, archived = false) {
      return store.listConversations(projectId).filter(s => (metadata(s.id).archived === true) === archived)
        .sort((a, b) => Number(!!metadata(b.id).pinned) - Number(!!metadata(a.id).pinned))
        .map(s => sessionView(s, trusted));
    }
    scheduler = new Scheduler({ store, concurrency: 2, run: async options => {
      const journal = journals.get(options.task.id);
      const { modelId, reasoningEffort, goal, images, configured } = journal;
      const entry = configured ?? (liveModels ? liveModels.routes.get(modelId) : { apiKey: fixture.apiKey,
        provider: { id: 'n01-desktop-fixture', name: 'Desktop local fixture', baseUrl: fixture.baseUrl,
          model: modelId, api: 'openai-completions', contextWindow: 64000, maxTokens: 2048, imageInput: modelId === 'fixture-alternate' } });
      const execution = { ...options, task: { ...options.task, text: options.task.message },
        provider: { ...entry.provider, thinkingLevel: reasoningEffort ?? 'off' }, apiKey: entry.apiKey, dataDir, imageGen: null, images,
        fork: metadata(options.conversation.id).fork ? { history: store.listMessages(options.conversation.id)
          .filter(m => m.taskId === null && ['user', 'assistant'].includes(m.role))
          .map(m => ({ role: m.role, text: m.content, timestamp: Date.parse(m.createdAt) })) } : undefined,
        permissions: { getMode: () => 'workspace-write' },
        sessionPolicy: { allowedTools: liveModels ? ['read', 'write', 'edit', 'ls', 'bash'] : ['read', 'write', 'bash'] } };
      try {
        const execute = () => !goal ? run(execution) : runDesktopTeamGoal(execution, goal, patch => {
          Object.assign(goal, patch);
          saveDesktopGoal(store, options.conversation.id, goal);
        });
        if (!history) return await execute();
        return await withWorkspaceChanges(options.project.path, options.signal, execute, changes => {
          journal.changes = { files: changes.files.slice(0, 100).filter(f => f.path.length <= 400),
            limited: changes.limited || changes.files.length > 100 || changes.files.some(f => f.path.length > 400) };
        });
      } catch (error) {
        if (options.signal.aborted) throw new TaskFailure('cancelled');
        // Preserve only known, sanitized PI failure codes; never forward an upstream error body.
        if ((liveModels || configured || goal || images) && error instanceof TaskFailure) throw new TaskFailure(error.code);
        throw new TaskFailure('internal');
      } finally { journal.images = undefined; journal.configured = undefined; }
    }, onEvent: event => {
      const journal = journals.get(event.taskId);
      if (event.type === 'task_state' && terminal.has(event.payload.status)) {
        journal.images = undefined;
        journal.configured = undefined;
      }
      journal.statistics.observe(event);
      const payload = publicPayload(event.type, event.payload);
      if (!payload) return;
      if (journal.goal && event.type.startsWith('tool_') && (journal.last >= 2800 || journal.bytes >= 768 * 1024)) {
        if (!journal.goal.toolPreviewLimited) {
          journal.goal.toolPreviewLimited = true;
          saveDesktopGoal(store, event.conversationId, journal.goal);
        }
        return; // Keep terminal delivery in the private UI page; SQLite retains the full event.
      }
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
        preview: { workspaceLabel: trusted.workspaceLabel, ...(history && { workspacePath: trusted.path }), createdAt: s.createdAt },
        ...(metadata(s.id).pinned && { pinned: true }) };
    }
    function dispatch(method, p) {
      switch (method) {
        case 'projects.list': exact(p, []); return {
          projects: (importedProject ? [importedProject, ...trustedProjects.filter(p => p !== importedProject)] : trustedProjects)
            .map(({ id, name }) => ({ id, name })),
          models: directory(), ...(history ? { teamGoals: true, desktopManagement: true } : {}),
        };
        case 'sessions.list': {
          exact(p, ['projectId']); const trusted = project(p.projectId);
          return { sessions: sessionList(p.projectId, trusted), ...historicalSessions(p.projectId, false) };
        }
        case 'sessions.create': {
          exact(p, ['projectId', 'title']); const trusted = project(p.projectId); title(p.title);
          if (sessionList(p.projectId, trusted).length >= 16) reject('limit');
          return { session: sessionView(store.createConversation(p.projectId, p.title), trusted) };
        }
        case 'sessions.manage': {
          if (!history) reject('unsupported_method');
          if (p?.action === 'importedPage') {
            exact(p, ['action', 'projectId', 'sessionId', 'before']);
            if (!imported) reject('unsupported_method');
            if (p.projectId !== importedProject.id) reject('not_found');
            if (!token(p.sessionId) || (p.before !== null && (!Number.isSafeInteger(p.before) || p.before < 1))) reject('invalid_request');
            return { sessions: [], importedPage: imported.page(p.sessionId, p.before) ?? reject('not_found') };
          }
          if (p?.action === 'importedAsset') {
            exact(p, ['action', 'projectId', 'sessionId', 'assetId', 'offset', 'reveal']);
            if (!imported) reject('unsupported_method');
            if (p.projectId !== importedProject.id) reject('not_found');
            if (!token(p.sessionId) || !Number.isSafeInteger(p.assetId) || p.assetId < 1 ||
                !Number.isSafeInteger(p.offset) || p.offset < 0 || typeof p.reveal !== 'boolean') reject('invalid_request');
            return { sessions: [], asset: imported.asset(p.sessionId, p.assetId, p.offset, p.reveal) ?? reject('not_found') };
          }
          if (p?.action === 'listArchived') {
            exact(p, ['projectId', 'action']);
            return { sessions: sessionList(p.projectId, project(p.projectId), true), ...historicalSessions(p.projectId, true) };
          }
          const fields = ['projectId', 'sessionId', 'action'];
          exact(p, p?.action === 'rename' ? [...fields, 'title'] : fields);
          const source = session(p.projectId, p.sessionId), trusted = project(p.projectId);
          const state = metadata(source.id);
          if (p.action === 'restore') {
            const active = sessionList(p.projectId, trusted);
            if (!state.archived) return { sessions: active, selectedId: source.id };
            if (active.length >= 16) reject('limit');
            saveMetadata(source.id, { ...state, archived: false });
            return { sessions: sessionList(p.projectId, trusted), selectedId: source.id };
          }
          if (state.archived) reject('not_found');
          if (p.action === 'reveal') {
            const child = spawn('/usr/bin/open', ['-R', trusted.path], { stdio: 'ignore' });
            child.on('error', () => {});
            child.unref();
            return { sessions: sessionList(p.projectId, trusted) };
          }
          if (p.action === 'rename') {
            store.renameConversation({ projectId: p.projectId, conversationId: source.id, title: title(p.title).trim() });
          } else if (p.action === 'pin') {
            saveMetadata(source.id, { ...state, pinned: !state.pinned });
          } else if (p.action === 'archive' || p.action === 'fork') {
            if (['queued', 'running'].includes(store.latestTask(source.id)?.status)) reject('conflict');
            if (p.action === 'archive') {
              saveMetadata(source.id, { ...state, archived: true });
            } else {
              if (sessionList(p.projectId, trusted).length >= 16) reject('limit');
              const messages = store.listMessages(source.id).filter(m => ['user', 'assistant'].includes(m.role));
              const fork = store.transaction(() => {
                const created = store.createConversation(p.projectId, source.title.slice(0, 95) + '（分支）');
                for (const m of messages) store.addMessage({ conversationId: created.id, role: m.role, content: m.content });
                saveMetadata(created.id, { fork: true });
                return created;
              });
              return { sessions: sessionList(p.projectId, trusted), selectedId: fork.id };
            }
          } else reject('invalid_request');
          return { sessions: sessionList(p.projectId, trusted) };
        }
        case 'models.manage': {
          if (!modelServices) reject('unsupported_method');
          if (p?.action === 'list') {
            exact(p, ['action']);
            return { services: modelServices.list(), models: directory() };
          }
          if (p?.action !== 'save') reject('invalid_request');
          exact(p, ['action', 'service', 'model']);
          try { return modelServices.save(p); }
          catch (error) { reject(['limit', 'not_found'].includes(error.message) ? error.message : 'invalid_request'); }
          break;
        }
        case 'images.stage': {
          if (!history) reject('unsupported_method');
          exact(p, ['projectId', 'sessionId', 'batchId', 'index', 'offset', 'data', 'mime']);
          session(p.projectId, p.sessionId);
          if (!token(p.batchId) || metadata(p.sessionId).archived) reject('invalid_request');
          return attachments.stage(p);
        }
        case 'sessions.history': {
          if (!history) reject('unsupported_method');
          exact(p, ['projectId', 'sessionId', 'before']);
          if (!token(p.projectId) || !token(p.sessionId)) reject('invalid_request');
          session(p.projectId, p.sessionId);
          if (p.before !== null && !token(p.before)) reject('invalid_cursor');
          const page = history.read(p, metadata(p.sessionId).fork === true) ?? reject('invalid_cursor');
          const teamGoal = desktopGoalView(store, readDesktopGoal(store, p.sessionId));
          return teamGoal ? { ...page, teamGoal } : page;
        }
        case 'tasks.submit': {
          const explicit = p && Object.hasOwn(p, 'modelId');
          const explicitEffort = p && Object.hasOwn(p, 'reasoningEffort');
          const goalRequest = p && Object.hasOwn(p, 'teamGoal');
          const withImages = p && Object.hasOwn(p, 'imageBatch');
          exact(p, ['projectId', 'sessionId', 'requestId', 'text', ...(explicit ? ['modelId'] : []),
            ...(explicitEffort ? ['reasoningEffort'] : []), ...(goalRequest ? ['teamGoal'] : []), ...(withImages ? ['imageBatch'] : [])]);
          session(p.projectId, p.sessionId);
          if (!token(p.requestId) || typeof p.text !== 'string' || !p.text.trim() || Buffer.byteLength(p.text) > 4096 || p.text.includes('\x00')) reject('invalid_request');
          if (goalRequest && (!history || !['start', 'resume'].includes(p.teamGoal))) reject('invalid_request');
          if (metadata(p.sessionId).archived) reject('not_found');
          if (withImages && (!history || goalRequest || !token(p.imageBatch))) reject('invalid_request');
          const existing = readDesktopGoal(store, p.sessionId);
          const resume = p.teamGoal === 'resume';
          const modelId = resume ? existing?.modelId : explicit ? p.modelId : directory().defaultId;
          const model = directory().options.find(m => m.id === modelId);
          if (!model) reject('invalid_request');
          if (explicitEffort && !model.reasoning?.levels.some(e => e.id === p.reasoningEffort)) reject('invalid_request');
          const reasoningEffort = resume ? existing.reasoningEffort : explicitEffort ? p.reasoningEffort : model.reasoning?.defaultId;
          if (resume && (explicit || explicitEffort)) reject('invalid_request');
          const key = `${p.sessionId}:${p.requestId}`, prior = requests.get(key);
          if (prior) {
            const admitted = journals.get(prior.id);
            if (prior.teamGoal !== p.teamGoal || prior.text !== p.text || prior.imageBatch !== p.imageBatch ||
                admitted.modelId !== modelId || admitted.reasoningEffort !== reasoningEffort) reject('conflict');
            const teamGoal = desktopGoalView(store, admitted.goal);
            return { task: taskView(store.getTask(prior.id)), replayed: true, ...(teamGoal && { teamGoal }) };
          }
          const status = desktopGoalView(store, existing)?.status;
          if (existing?.requestId === p.requestId || status === 'queued' || status === 'running') reject('conflict');
          if (resume && (!['paused', 'blocked'].includes(status) || existing.objective !== p.text)) reject('conflict');
          if (p.teamGoal === 'start' && existing && status !== 'completed') reject('conflict');
          const goal = goalRequest ? {
            ...(resume ? existing : { id: randomUUID(), objective: p.text, round: 0 }),
            modelId, reasoningEffort, requestId: p.requestId, phase: 'planning', verifiedMembers: 0, toolPreviewLimited: false,
          } : undefined;
          if (requests.size >= 32) reject('limit');
          if (withImages && !model.imageInput) reject('invalid_request');
          const images = withImages ? attachments.peek(p.sessionId, p.imageBatch) : undefined;
          if (images && [...journals.values()].reduce((sum, j) =>
              sum + (j.images?.reduce((total, i) => total + i.data.length, 0) ?? 0), 0) +
              images.reduce((sum, i) => sum + i.data.length, 0) > 64 * 1024 * 1024) reject('limit');
          const configured = modelServices && modelServices.route(modelId);
          const created = scheduler.submit({ conversationId: p.sessionId, message: p.text, timeoutMs: goal ? 7200000 : 600000,
            onCreate: t => {
              if (goal) saveDesktopGoal(store, p.sessionId, Object.assign(goal, { taskId: t.id }));
              journals.set(t.id, { modelId, reasoningEffort, goal, images, configured, events: [], last: 0, floor: 0, bytes: 0, statistics: desktopTaskStatistics() });
            } });
          if (withImages) attachments.consume(p.sessionId, p.imageBatch);
          requests.set(key, { id: created.id, text: p.text, teamGoal: p.teamGoal, imageBatch: p.imageBatch });
          return { task: taskView(created), replayed: false, ...(goal && { teamGoal: desktopGoalView(store, goal) }) };
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
          const teamGoal = desktopGoalView(store, journal.goal);
          return { task: taskView(found), terminal: ended, events,
            cursor: `${found.id}:${next}`, hasMore,
            ...(teamGoal && { teamGoal }),
            ...(ended && !hasMore ? { statistics: journal.statistics.snapshot(),
              ...(journal.changes && { workspaceChanges: journal.changes }) } : {}) };
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
      attachments.clear();
      if (!closing) closing = (async () => {
        const drained = await scheduler.shutdown({ timeoutMs: 15000 });
        if (!drained.drained) throw new Error('Desktop drain incomplete; state retained');
        await fixture?.close(); imported?.close(); history?.close(); store.close(); await release();
      })();
      return closing;
    }
    await lease?.ready();
    return { call, close, trustedProjects };
  } catch (error) {
    const drained = await scheduler?.shutdown({ timeoutMs: 15000 });
    if (!drained || drained.drained) { await fixture?.close(); imported?.close(); history?.close(); store?.close(); await release(); }
    throw error;
  }
}
