import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { basename } from 'node:path';

const statuses = new Set(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted']);
const now = () => new Date().toISOString();
function text(value, label, empty = false) {
  if (typeof value !== 'string' || (!empty && !value.trim())) throw new Error(`Invalid ${label}`);
  return value;
}
const row = value => value ? { ...value } : undefined;

export class Store {
  #db;
  #closed = false;
  constructor({ dbPath }) {
    this.#db = new DatabaseSync(dbPath);
    this.#db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, createdAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL, createdAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        conversationId TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        message TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled','interrupted')),
        createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, error TEXT
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        conversationId TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        type TEXT NOT NULL, payload TEXT NOT NULL, createdAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, conversationId TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        taskId TEXT REFERENCES tasks(id) ON DELETE CASCADE,
        role TEXT NOT NULL, content TEXT NOT NULL, createdAt TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS tasks_project_status ON tasks(projectId, status);
      CREATE INDEX IF NOT EXISTS events_task_id ON events(taskId, id);
      CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversationId);
      CREATE INDEX IF NOT EXISTS tasks_conversation ON tasks(conversationId);
      CREATE INDEX IF NOT EXISTS events_conversation ON events(conversationId);
    `);
  }
  #one(sql, ...params) { return row(this.#db.prepare(sql).get(...params)); }
  #all(sql, ...params) { return this.#db.prepare(sql).all(...params).map(row); }
  #required(table, id, label) {
    if (typeof id !== 'string' || !id) throw new Error(`${label} not found`);
    const found = this.#one(`SELECT * FROM ${table} WHERE id = ?`, id);
    if (!found) throw new Error(`${label} not found`);
    return found;
  }
  transaction(action) {
    this.#db.exec('BEGIN IMMEDIATE');
    try { const result = action(); this.#db.exec('COMMIT'); return result; }
    catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }
  getProject(id) { return this.#required('projects', id, 'Project'); }
  getConversation(id) { return this.#required('conversations', id, 'Conversation'); }
  getTask(id) { return this.#required('tasks', id, 'Task'); }
  listProjects() { return this.#all('SELECT * FROM projects ORDER BY rowid'); }
  #checkMetadataBudget(collection, candidate) {
    const metadata = { projects: this.listProjects(), conversations: this.#all('SELECT * FROM conversations ORDER BY rowid') };
    metadata[collection].push(candidate);
    if (Buffer.byteLength(JSON.stringify(metadata)) > 192 * 1024) throw new Error('Metadata budget limit reached');
  }
  async addProject(path) {
    let canonical;
    try {
      canonical = await realpath(text(path, 'directory'));
      if (!(await stat(canonical)).isDirectory()) throw new Error();
    } catch { throw new Error('Project directory is unavailable'); }
    const existing = this.#one('SELECT * FROM projects WHERE path = ?', canonical);
    if (existing) return existing;
    const name = basename(canonical) || canonical;
    if (Buffer.byteLength(canonical) > 4096 || Buffer.byteLength(name) > 255) throw new Error('Invalid project directory metadata');
    if (this.#one('SELECT count(*) AS count FROM projects').count >= 32) throw new Error('Project limit reached');
    this.#checkMetadataBudget('projects', { id: randomUUID(), name, path: canonical, createdAt: now() });
    this.#db.prepare('INSERT OR IGNORE INTO projects VALUES (?, ?, ?, ?)')
      .run(randomUUID(), name, canonical, now());
    return this.#one('SELECT * FROM projects WHERE path = ?', canonical);
  }
  removeProject(id) {
    return this.transaction(() => {
      this.getProject(id);
      if (this.#one("SELECT id FROM tasks WHERE projectId = ? AND status IN ('queued','running') LIMIT 1", id)) {
        throw new Error('Project has active tasks');
      }
      this.#db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    });
  }
  listConversations(projectId) {
    this.getProject(projectId);
    return this.#all('SELECT * FROM conversations WHERE projectId = ? ORDER BY rowid', projectId);
  }
  createConversation(projectId, title = '新会话') {
    this.getProject(projectId); text(title, 'title');
    if (title.length > 200) throw new Error('Invalid title: maximum 200 characters');
    if (this.#one('SELECT count(*) AS count FROM conversations').count >= 128) throw new Error('Conversation limit reached');
    const id = randomUUID();
    this.#checkMetadataBudget('conversations', { id, projectId, title, createdAt: now() });
    this.#db.prepare('INSERT INTO conversations VALUES (?, ?, ?, ?)').run(id, projectId, title, now());
    return this.getConversation(id);
  }
  listMessages(conversationId) {
    this.getConversation(conversationId);
    return this.#all('SELECT * FROM messages WHERE conversationId = ? ORDER BY rowid', conversationId);
  }
  addMessage({ conversationId, taskId = null, role, content }) {
    this.getConversation(conversationId);
    if (taskId !== null && this.getTask(taskId).conversationId !== conversationId) throw new Error('Task belongs to another conversation');
    if (!['user', 'assistant', 'system', 'tool'].includes(role)) throw new Error('Invalid role');
    text(content, 'content', true);
    const id = randomUUID();
    this.#db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?)').run(id, conversationId, taskId, role, content, now());
    return this.#one('SELECT * FROM messages WHERE id = ?', id);
  }
  createTask({ conversationId, message }) {
    const conversation = this.getConversation(conversationId); text(message, 'message');
    const id = randomUUID(), time = now();
    this.#db.prepare('INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, NULL)')
      .run(id, conversation.projectId, conversationId, message, 'queued', time, time);
    return this.getTask(id);
  }
  listTasks() { return this.#all('SELECT * FROM tasks ORDER BY rowid DESC'); }
  countActiveTasks() { return this.#one("SELECT count(*) AS count FROM tasks WHERE status IN ('queued','running')").count; }
  updateTask(id, { status, error = null }) {
    this.getTask(id);
    if (!statuses.has(status)) throw new Error('Invalid status');
    if (error !== null) text(error, 'error', true);
    this.#db.prepare('UPDATE tasks SET status = ?, error = ?, updatedAt = ? WHERE id = ?').run(status, error, now(), id);
    return this.getTask(id);
  }
  appendEvent(taskId, type, payload) {
    const task = this.getTask(taskId); text(type, 'event type');
    let json;
    try { json = JSON.stringify(payload); } catch { throw new Error('Invalid event payload'); }
    if (json === undefined) throw new Error('Invalid event payload');
    const result = this.#db.prepare('INSERT INTO events (taskId, projectId, conversationId, type, payload, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(taskId, task.projectId, task.conversationId, type, json, now());
    const event = this.#one('SELECT * FROM events WHERE id = ?', Number(result.lastInsertRowid));
    return { ...event, payload: JSON.parse(event.payload) };
  }
  listEvents(taskId, after = 0) {
    if (!Number.isSafeInteger(after) || after < 0) throw new Error('Invalid event cursor');
    if (taskId !== undefined) this.getTask(taskId);
    const events = taskId === undefined
      ? this.#all('SELECT * FROM events WHERE id > ? ORDER BY id', after)
      : this.#all('SELECT * FROM events WHERE taskId = ? AND id > ? ORDER BY id', taskId, after);
    return events.map(event => ({ ...event, payload: JSON.parse(event.payload) }));
  }
  // Transport views only: persisted history and the runner's full-history APIs stay intact.
  snapshotHistory({ conversationId, before = {}, historyRow } = {}) {
    if (!before || typeof before !== 'object' || Array.isArray(before)) throw new Error('Invalid history cursor');
    if ((Object.keys(before).length || historyRow) && !conversationId) throw new Error('History cursor requires conversationId');
    if (conversationId !== undefined) this.getConversation(conversationId);
    const collections = ['messages', 'tasks', 'events'];
    if (Object.keys(before).some(key => !collections.includes(key))) throw new Error('Invalid history cursor');
    const result = { messages: [], tasks: [], events: [], history: { version: 1, pages: [] } };
    const decode = (collection, value) => collection === 'events' ? { ...value, payload: JSON.parse(value.payload) } : value;
    if (historyRow) {
      const { collection, id, offset = 0, revision } = historyRow;
      if (!collections.includes(collection) || !Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid history row cursor');
      const found = this.#one(`SELECT * FROM ${collection} WHERE id = ? AND conversationId = ?`, id, conversationId);
      if (!found) throw new Error('History row not found in conversation');
      const json = JSON.stringify(decode(collection, found));
      const digest = createHash('sha256').update(json).digest('hex');
      if (offset > 0 && typeof revision !== 'string') throw new Error('History row revision required');
      if (revision !== undefined && revision !== digest) throw new Error('Stale history row revision; restart at offset 0');
      if (offset > json.length) throw new Error('Invalid history row cursor');
      const end = Math.min(json.length, offset + 32768);
      result.history.row = { collection, id, offset, revision: digest, json: json.slice(offset, end), nextOffset: end < json.length ? end : null, totalLength: json.length };
      return result;
    }
    const conversations = conversationId ? [this.getConversation(conversationId)] : this.#all('SELECT * FROM conversations ORDER BY rowid');
    const budget = Math.floor(512 * 1024 / Math.max(1, conversations.length) / 3);
    for (const conversation of conversations) {
      const page = { conversationId: conversation.id };
      for (const collection of collections) {
        let boundary = Number.MAX_SAFE_INTEGER;
        const cursor = before[collection];
        if (cursor !== undefined && cursor !== null) {
          if ((collection === 'events' && (!Number.isSafeInteger(cursor) || cursor < 1)) ||
              (collection !== 'events' && (typeof cursor !== 'string' || !cursor))) throw new Error('Invalid history cursor');
          const found = this.#one(`SELECT rowid AS position FROM ${collection} WHERE id = ? AND conversationId = ?`, cursor, conversation.id);
          if (!found) throw new Error('Invalid history cursor for conversation');
          boundary = found.position;
        }
        const total = this.#one(`SELECT count(*) AS count FROM ${collection} WHERE conversationId = ?`, conversation.id).count;
        const candidates = this.#all(`SELECT rowid AS position, * FROM ${collection} WHERE conversationId = ? AND rowid < ? ORDER BY rowid DESC LIMIT 51`, conversation.id, boundary);
        const selected = [], truncatedRows = [];
        let bytes = 0;
        for (const candidate of candidates.slice(0, 50)) {
          const { position, ...raw } = candidate;
          let value = decode(collection, raw);
          const originalBytes = Buffer.byteLength(JSON.stringify(value));
          const truncated = originalBytes > Math.min(32768, budget / 2);
          if (truncated) {
            // Keep row identity/status and the existing frontend field types.
            value = collection === 'messages' ? { ...raw, content: '' }
              : collection === 'events' ? { ...raw, type: raw.type.slice(0, 100), payload: {} }
              : { ...raw, message: '', error: raw.error === null ? null : '' };
          }
          const size = Buffer.byteLength(JSON.stringify(value)) + (truncated ? 160 : 0);
          if (bytes + size > budget) break;
          bytes += size;
          selected.push(value);
          if (truncated) truncatedRows.push({ id: raw.id, originalBytes, historyRow: { collection, id: raw.id, offset: 0 } });
        }
        page[collection] = { total, hasMore: candidates.length > selected.length,
          before: selected.at(-1)?.id ?? cursor ?? null, truncatedRows,
          requiresScopedPage: candidates.length > 0 && selected.length === 0 };
        result[collection].push(...(collection === 'tasks' ? selected : selected.reverse()));
      }
      result.history.pages.push(page);
    }
    // Active state is independent of terminal history pagination. Reserve at most
    // 128 compact rows (~64 KiB); full fields remain available through historyRow.
    const active = conversationId
      ? this.#all("SELECT * FROM tasks WHERE conversationId = ? AND status IN ('queued','running') ORDER BY rowid DESC", conversationId)
      : this.#all("SELECT * FROM tasks WHERE status IN ('queued','running') ORDER BY rowid DESC");
    for (const task of active) {
      if (result.tasks.some(item => item.id === task.id)) continue;
      const originalBytes = Buffer.byteLength(JSON.stringify(task));
      result.tasks.push({ ...task, message: '', error: task.error === null ? null : '' });
      const page = result.history.pages.find(item => item.conversationId === task.conversationId);
      page.tasks.truncatedRows.push({ id: task.id, originalBytes, historyRow: { collection: 'tasks', id: task.id, offset: 0 } });
    }
    return result;
  }
  interruptUnfinished() {
    return this.transaction(() => {
      const tasks = this.#all("SELECT * FROM tasks WHERE status IN ('queued','running') ORDER BY rowid");
      for (const task of tasks) {
        this.updateTask(task.id, { status: 'interrupted' });
        this.appendEvent(task.id, 'task_state', { status: 'interrupted' });
      }
      return tasks.length;
    });
  }
  close() { if (!this.#closed) { this.#db.close(); this.#closed = true; } }
}

export default Store;
