import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';

const terminal = new Set(['succeeded', 'failed', 'cancelled']);
const fixtureInput = /^MOOS_FIXTURE_(?:WRITE [a-zA-Z0-9_]{1,32}|TOOLS|HOLD|AUTH_FAIL|RATE_LIMIT|POLICY|APPROVAL)$/;

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
      return run({ ...options, task: { ...options.task, text: options.task.message },
        ...contextByTask.get(options.task.id) });
    },
    onEvent(event) { listeners.get(event.taskId)?.(event); },
  });
  let closing;

  async function open({ sessionId, cwd, input, signal, permissions, provider }) {
    if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(sessionId)
      || typeof input !== 'string' || !input.trim() || Buffer.byteLength(input) > 100000
      || fixtureRoot && !fixtureInput.test(input)) throw new Error('Invalid PI task');
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
      const conversation = store.createConversation(project.id);
      store.setSetting(key, conversation.id);
      return conversation.id;
    });
    const task = scheduler.submit({ conversationId, message: input });
    contextByTask.set(task.id, { permissions, provider });
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
      } else if (event.type === 'text_delta' || event.type === 'tool_end') {
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

  return {
    open,
    close() {
      closing ??= scheduler.shutdown({ timeoutMs: 15000 }).then(({ drained }) => {
        if (!drained) throw new Error('PI tasks did not stop');
        store.close();
      });
      return closing;
    },
  };
}
