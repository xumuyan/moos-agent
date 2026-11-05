export class Scheduler {
  #store;
  #run;
  #concurrency;
  #onEvent;
  #queue = [];
  #active = new Map();
  #paths = new Set();
  #stopped = false;
  #scheduled = false;

  constructor({ store, run, concurrency = 2, onEvent = () => {} }) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error('Invalid concurrency');
    if (typeof run !== 'function' || typeof onEvent !== 'function') throw new Error('Invalid scheduler callback');
    this.#store = store; this.#run = run; this.#concurrency = concurrency; this.#onEvent = onEvent;
  }
  #publish(event) {
    try { Promise.resolve(this.#onEvent(event)).catch(() => {}); } catch { /* Observers cannot change task execution. */ }
  }
  #state(id, status, error) {
    const payload = error === undefined ? { status } : { status, error };
    const event = this.#store.transaction(() => {
      this.#store.updateTask(id, payload);
      return this.#store.appendEvent(id, 'task_state', payload);
    });
    this.#publish(event);
  }
  submit({ conversationId, message }) {
    if (this.#stopped) throw new Error('Scheduler is shut down');
    let event;
    const task = this.#store.transaction(() => {
      const task = this.#store.createTask({ conversationId, message });
      this.#store.addMessage({ conversationId, taskId: task.id, role: 'user', content: message });
      event = this.#store.appendEvent(task.id, 'task_state', { status: 'queued' });
      return task;
    });
    this.#queue.push(task.id);
    this.#publish(event);
    this.#schedule();
    return task;
  }
  #schedule() {
    if (this.#scheduled || this.#stopped) return;
    this.#scheduled = true;
    queueMicrotask(() => { this.#scheduled = false; this.#pump(); });
  }
  #pump() {
    while (!this.#stopped && this.#active.size < this.#concurrency) {
      const index = this.#queue.findIndex(id => {
        const task = this.#store.getTask(id);
        return !this.#paths.has(this.#store.getProject(task.projectId).path);
      });
      if (index < 0) return;
      const [id] = this.#queue.splice(index, 1);
      const task = this.#store.getTask(id);
      const project = this.#store.getProject(task.projectId);
      const conversation = this.#store.getConversation(task.conversationId);
      const entry = { controller: new AbortController(), promise: null };
      this.#paths.add(project.path);
      this.#active.set(id, entry);
      // Defer runner entry until registration, so even synchronous runners are tracked.
      entry.promise = Promise.resolve().then(() => this.#execute(task, project, conversation, entry))
        .finally(() => {
          this.#active.delete(id); this.#paths.delete(project.path); this.#schedule();
        });
    }
  }
  async #execute(task, project, conversation, entry) {
    const { signal } = entry.controller;
    let open = true;
    try {
      if (signal.aborted) { this.#state(task.id, 'cancelled'); return; }
      this.#state(task.id, 'running');
      const result = await this.#run({
        task: this.#store.getTask(task.id), project, conversation, signal,
        emit: (type, payload) => {
          if (!open || signal.aborted) return;
          if (type === 'task_state') throw new Error('Task state events are reserved');
          const event = this.#store.appendEvent(task.id, type, payload);
          this.#publish(event);
          return event;
        },
      });
      open = false;
      if (signal.aborted) { this.#state(task.id, 'cancelled'); return; }
      if (!result || typeof result.text !== 'string') throw new Error('Invalid runner result');
      let event;
      this.#store.transaction(() => {
        this.#store.addMessage({ conversationId: conversation.id, taskId: task.id, role: 'assistant', content: result.text });
        this.#store.updateTask(task.id, { status: 'succeeded' });
        event = this.#store.appendEvent(task.id, 'task_state', { status: 'succeeded' });
      });
      this.#publish(event);
    } catch {
      open = false;
      this.#state(task.id, signal.aborted ? 'cancelled' : 'failed', signal.aborted ? undefined : 'Task execution failed');
    } finally { open = false; }
  }
  cancel(taskId) {
    const task = this.#store.getTask(taskId);
    const index = this.#queue.indexOf(taskId);
    if (index >= 0) {
      this.#queue.splice(index, 1);
      this.#state(taskId, 'cancelled');
      this.#schedule();
    } else if (this.#active.has(taskId)) {
      this.#active.get(taskId).controller.abort();
    } else if (task.status === 'queued' || task.status === 'running') {
      throw new Error('Task is not owned by this scheduler');
    }
    return this.#store.getTask(taskId);
  }
  async shutdown({ timeoutMs = 1000 } = {}) {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new Error('Invalid shutdown timeout');
    this.#stopped = true;
    for (const id of [...this.#queue]) this.cancel(id);
    for (const entry of this.#active.values()) entry.controller.abort();
    const pending = [...this.#active.values()].map(entry => entry.promise);
    if (!pending.length) return { drained: true };
    let timer;
    try {
      return await Promise.race([
        Promise.allSettled(pending).then(() => ({ drained: true })),
        new Promise(resolve => { timer = setTimeout(() => resolve({ drained: false }), timeoutMs); }),
      ]);
    } finally { clearTimeout(timer); }
  }
}

export default Scheduler;
