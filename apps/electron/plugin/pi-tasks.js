import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';

const terminal = new Set(['succeeded', 'failed', 'cancelled']);
const fixtureInput = /^MOOS_FIXTURE_(?:WRITE [a-zA-Z0-9_]{1,32}|TOOLS|HOLD|AUTH_FAIL|RATE_LIMIT|POLICY|APPROVAL)$/;

// This bridge accepts only explicitly provisioned fixture projects and inputs
// until the real-project permission policy has been implemented.
export function createFixtureTasks({ store, Scheduler, run, root }) {
  const listeners = new Map();
  const permissionsByTask = new Map();
  const verifyWorkspace = async path => {
    if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('Invalid fixture workspace');
    const canonical = await realpath(path);
    const child = relative(root, canonical);
    if (!child || child === '..' || child.startsWith('..' + sep) || isAbsolute(child)) {
      throw new Error('Invalid fixture workspace');
    }
    return canonical;
  };
  const scheduler = new Scheduler({
    store,
    async run(options) {
      if (await verifyWorkspace(options.project.path) !== options.project.path) throw new Error('Fixture workspace moved');
      return run({ ...options, task: { ...options.task, text: options.task.message },
        permissions: permissionsByTask.get(options.task.id) });
    },
    onEvent(event) { listeners.get(event.taskId)?.(event); },
  });
  let closing;

  async function open({ sessionId, cwd, input, signal, permissions }) {
    if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(sessionId)
      || typeof input !== 'string' || !fixtureInput.test(input)) throw new Error('Invalid fixture task');
    const canonical = await verifyWorkspace(cwd);
    signal.throwIfAborted();
    if (closing || store.countActiveTasks() >= 128) throw new Error('Fixture scheduler unavailable');
    const project = await store.addProject(canonical);
    signal.throwIfAborted();
    if (closing || project.path !== canonical || store.countActiveTasks() >= 128) {
      throw new Error('Fixture scheduler unavailable');
    }
    const conversationId = store.transaction(() => {
      const key = 'dsh-session:' + sessionId;
      const storedId = store.getSetting(key);
      if (storedId) {
        const conversation = store.getConversation(storedId);
        if (conversation.projectId !== project.id) throw new Error('Fixture session belongs to another workspace');
        return storedId;
      }
      const conversation = store.createConversation(project.id);
      store.setSetting(key, conversation.id);
      return conversation.id;
    });
    const task = scheduler.submit({ conversationId, message: input });
    permissionsByTask.set(task.id, permissions);
    const pending = [];
    const settled = Promise.withResolvers();
    let done = false;
    let wake;
    const cancel = () => { if (!done) scheduler.cancel(task.id); };
    listeners.set(task.id, event => {
      if (event.type === 'task_state' && terminal.has(event.payload.status)) {
        done = true;
        listeners.delete(task.id);
        permissionsByTask.delete(task.id);
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
        if (!drained) throw new Error('PI fixture tasks did not stop');
        store.close();
      });
      return closing;
    },
  };
}
