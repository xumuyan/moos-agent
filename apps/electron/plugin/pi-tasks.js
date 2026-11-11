import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { withWorkspaceChanges } from './pi-workspace-changes.js';

const terminal = new Set(['succeeded', 'failed', 'cancelled']);
const retryable = new Set(['failed', 'cancelled', 'interrupted']);
const fixtureInput = /^MOOS_FIXTURE_(?:WRITE [a-zA-Z0-9_]{1,32}|TOOLS|HOLD|AUTH_FAIL|RATE_LIMIT|POLICY|APPROVAL|RETRY)$/;

// Both regular and fixture tasks share scheduling and workspace identity.
export function createPiTasks({ store, Scheduler, run, fixtureRoot, dataRoot }) {
  const listeners = new Map();
  const contextByTask = new Map();
  const verifyWorkspace = async path => {
    if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('Invalid PI workspace');
    const canonical = await realpath(path);
    const contains = (root, target) => {
      const child = relative(root, target);
      return child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child);
    };
    if (fixtureRoot && (!contains(fixtureRoot, canonical) || canonical === fixtureRoot)) {
      throw new Error('Invalid fixture workspace');
    }
    if (dataRoot && (contains(canonical, dataRoot) ||
      contains(dataRoot, canonical) && !contains(dataRoot + sep + 'workspace', canonical))) {
      throw new Error('PI workspaces cannot contain private app data');
    }
    return canonical;
  };
  const scheduler = new Scheduler({
    store,
    async run(options) {
      if (await verifyWorkspace(options.project.path) !== options.project.path) throw new Error('PI workspace moved');
      const input = { ...options, task: { ...options.task, text: options.task.message },
        ...contextByTask.get(options.task.id) };
      return withWorkspaceChanges(options.project.path, options.signal, () => run(input),
        changes => options.emit('workspace_changes', changes));
    },
    onEvent(event) { listeners.get(event.taskId)?.(event); },
  });
  let closing;

  function retryTask(sessionId, retryOf) {
    const id = store.getSetting('dsh-session:' + sessionId);
    const previous = id && store.latestTask(id);
    if (previous?.id !== retryOf || !retryable.has(previous.status)) {
      throw new Error('PI retry target is no longer available');
    }
    return previous;
  }

  async function open({ sessionId, turnStartSeq, cwd, input, messageId, fork, retryOf, signal, permissions, provider, backup,
    imageRefs, images }) {
    if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(sessionId)
      || (!retryOf && (typeof input !== 'string' || !input.trim() || Buffer.byteLength(input) > 100000
      || fixtureRoot && !fixtureInput.test(input)))) throw new Error('Invalid PI task');
    const canonical = await verifyWorkspace(cwd);
    signal.throwIfAborted();
    if (closing || store.countActiveTasks() >= 128) throw new Error('PI scheduler unavailable');
    const project = await store.addProject(canonical);
    signal.throwIfAborted();
    if (closing || project.path !== canonical || store.countActiveTasks() >= 128) {
      throw new Error('PI scheduler unavailable');
    }
    const conversationId = store.transaction(() => {
      const key = 'dsh-session:' + sessionId;
      const storedId = store.getSetting(key);
      if (storedId) {
        const conversation = store.getConversation(storedId);
        if (conversation.projectId !== project.id) throw new Error('PI session belongs to another workspace');
        return storedId;
      }
      if (retryOf) throw new Error('PI session has no previous task');
      const conversation = store.createConversation(project.id);
      store.setSetting(key, conversation.id);
      return conversation.id;
    });
    const previous = retryOf && retryTask(sessionId, retryOf);
    let origin;
    if (fork?.checkpoint) {
      const sourceId = store.getSetting('dsh-message:' + fork.checkpoint);
      if (sourceId) {
        const source = store.getTask(sourceId);
        if (source.status === 'succeeded' && source.projectId === project.id && source.conversationId !== conversationId) {
          const checkpoint = store.lastTaskEvent(source.id, 'pi_checkpoint');
          if (checkpoint) origin = { ...checkpoint, conversationId: source.conversationId };
        }
      }
    }
    const captureCheckpoint = typeof messageId === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(messageId);
    const task = scheduler.submit({ conversationId, message: previous?.message ?? input, onCreate(created) {
      if (Number.isSafeInteger(turnStartSeq) && turnStartSeq >= 0) {
        store.setSetting('dsh-turn:' + sessionId + ':' + turnStartSeq, created.id);
      }
      if (captureCheckpoint) store.setSetting('dsh-message:' + messageId, created.id);
      if (imageRefs?.length) store.setSetting('dsh-image:' + created.id, JSON.stringify(imageRefs));
      if (previous) store.appendEvent(created.id, 'task_retry', { previousTaskId: previous.id });
    } });
    contextByTask.set(task.id, { permissions, provider, backup, images, retry: Boolean(previous), captureCheckpoint,
      fork: fork && { origin, history: fork.history } });
    const pending = [];
    const settled = Promise.withResolvers();
    let done = false;
    let wake;
    const cancel = () => { if (!done) scheduler.cancel(task.id); };
    listeners.set(task.id, event => {
      if (event.type === 'task_state' && terminal.has(event.payload.status)) {
        done = true;
        listeners.delete(task.id);
        contextByTask.delete(task.id);
        signal.removeEventListener('abort', cancel);
        settled.resolve();
        pending.push(event);
      } else if (event.type === 'text_delta') {
        pending.push(event);
      }
      wake?.();
    });
    signal.addEventListener('abort', cancel, { once: true });
    return {
      async *events() {
        while (!done || pending.length) {
          if (pending.length) yield pending.shift();
          else await new Promise(resolve => { wake = resolve; });
        }
      },
      async stop() {
        cancel();
        await settled.promise;
      },
    };
  }

  async function inheritTurns(session) {
    const id = session?.id;
    const parent = session?.header?.parentSession;
    const end = session?.inheritedEventCount;
    const validId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(value);
    if (!session?.header?.isSeeded || !validId(id) || parent !== undefined && (!validId(parent) || id === parent)
      || !Number.isSafeInteger(end) || end <= 0) return;
    const cwd = await verifyWorkspace(session.header.cwd);
    const events = session.snapshotEvents(Math.max(0, end - 1600), end);
    const inherited = [];
    let start;
    let message;
    for (const event of events) {
      if (!Number.isSafeInteger(event.seq) || event.seq < 0 || event.seq >= end) continue;
      if (event.type === 'turn/start') { start = event.seq; message = undefined; }
      else if (start !== undefined && event.type === 'user/message' && event.data?.source?.kind === 'user') {
        message = event.data.id;
      } else if (event.type === 'turn/end') {
        if (start !== undefined && event.data?.reason?.kind === 'completed'
          && typeof message === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(message)) {
          const direct = parent && store.getSetting('dsh-turn:' + parent + ':' + start);
          let sourceId = direct;
          if (parent && !sourceId) {
            const saved = store.getSetting('dsh-inherited-turn:' + parent + ':' + start);
            try { sourceId = saved && JSON.parse(saved).taskId; } catch { /* Invalid legacy metadata stays hidden. */ }
          }
          // Ordinary DSH forks omit parentSession. In that case the trusted
          // inherited user-message ID locates the original PI task directly.
          if (!parent) sourceId = store.getSetting('dsh-message:' + message);
          if (sourceId && store.getSetting('dsh-message:' + message) === sourceId) {
            const source = store.getTask(sourceId);
            if (source.status === 'succeeded' && store.getProject(source.projectId).path === cwd) {
              inherited.push([start, { taskId: source.id, projectId: source.projectId, messageId: message }]);
            }
          }
        }
        start = undefined; message = undefined;
      }
    }
    // Presentation references only: do not duplicate messages, tasks, events or
    // usage; a newly forked conversation must not replay its parent's work.
    store.transaction(() => {
      for (const [seq, value] of inherited) store.setSetting('dsh-inherited-turn:' + id + ':' + seq, JSON.stringify(value));
    });
  }

  return {
    open, inheritTurns,
    retryImage(sessionId, retryOf) {
      const value = store.getSetting('dsh-image:' + retryTask(sessionId, retryOf).id);
      return value && JSON.parse(value);
    },
    close() {
      closing ??= scheduler.shutdown({ timeoutMs: 15000 }).then(({ drained }) => {
        if (!drained) throw new Error('PI tasks did not stop');
        store.close();
      });
      return closing;
    },
  };
}
