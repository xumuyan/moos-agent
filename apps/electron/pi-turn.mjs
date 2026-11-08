import { isWorkspaceChangeVisible } from './plugin/pi-workspace-changes.js';
import { DatabaseSync } from 'node:sqlite';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const labels = {
  read: '读取文件', write: '写入文件', edit: '局部修改', bash: '运行命令',
  bash_escalated: '经审批运行命令', grep: '搜索内容', find: '查找文件', ls: '查看目录',
};
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'interrupted']);

function workspacePath(cwd, path) {
  if (typeof path !== 'string' || !path || path.length > 2048 || path.startsWith('~') || /[\x00-\x1f\x7f]/.test(path)) return;
  const name = relative(cwd, resolve(cwd, path));
  if (name === '..' || name.startsWith('..' + sep) || isAbsolute(name)) return;
  return name || '.';
}

export function createPiTurnReader(dbPath, timelinePayload) {
  let db;
  return {
    active() {
      db ??= new DatabaseSync(dbPath, { readOnly: true });
      return db.prepare(`
        SELECT tasks.id, substr(settings.key, 13) AS sessionId, tasks.status,
          substr(projects.name, 1, 120) AS project
        FROM tasks JOIN projects ON projects.id = tasks.projectId
        JOIN settings ON settings.value = tasks.conversationId
          AND settings.key >= 'dsh-session:' AND settings.key < 'dsh-session;'
        WHERE tasks.status IN ('queued', 'running')
        ORDER BY tasks.status = 'queued', tasks.rowid LIMIT 128
      `).all().filter(task => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(task.sessionId));
    },
    read(sessionId, startSeq) {
      if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(sessionId)
        || startSeq !== null && startSeq !== 'retry' && (!Number.isSafeInteger(startSeq) || startSeq < 0)) {
        throw new Error('Invalid Moos turn');
      }
      db ??= new DatabaseSync(dbPath, { readOnly: true });
      if (startSeq === 'retry') {
        const latest = db.prepare(`SELECT id, status, errorCode FROM tasks
          WHERE conversationId = (SELECT value FROM settings WHERE key = ?) ORDER BY rowid DESC LIMIT 1`)
          .get('dsh-session:' + sessionId);
        return latest && ['failed', 'cancelled', 'interrupted'].includes(latest.status) ? latest : null;
      }
      const live = startSeq === null;
      let task = db.prepare(`
        SELECT tasks.id, tasks.status, projects.path
        FROM tasks JOIN projects ON projects.id = tasks.projectId
        WHERE tasks.conversationId = (SELECT value FROM settings WHERE key = ?)
          AND ${live ? "tasks.status IN ('queued', 'running')" : 'tasks.id = (SELECT value FROM settings WHERE key = ?)'}
        ORDER BY tasks.rowid DESC LIMIT 1
      `).get('dsh-session:' + sessionId, ...(live ? [] : ['dsh-turn:' + sessionId + ':' + startSeq]));
      if (!task && !live) {
        // Written by the Host only after checking the actual seeded prefix,
        // source message identity and canonical workspace. Never follow a
        // renderer-supplied parent/session ID or use inherited work as live work.
        const saved = db.prepare('SELECT value FROM settings WHERE key = ?')
          .get('dsh-inherited-turn:' + sessionId + ':' + startSeq);
        let ref;
        try { ref = saved && JSON.parse(saved.value); } catch { /* Hide malformed references. */ }
        if (ref && typeof ref.taskId === 'string' && typeof ref.projectId === 'string'
          && typeof ref.messageId === 'string') task = db.prepare(`
          SELECT tasks.id, tasks.status, projects.path
          FROM tasks JOIN projects ON projects.id = tasks.projectId
          WHERE tasks.id = ? AND tasks.projectId = ?
            AND tasks.id = (SELECT value FROM settings WHERE key = ?)
            AND tasks.status = 'succeeded'
          LIMIT 1
        `).get(ref.taskId, ref.projectId, 'dsh-message:' + ref.messageId);
      }
      if (!task) return null;

      // Select only presentation inputs. Source code and tool output never
      // enter the read model or the workbench IPC response.
      const events = db.prepare(`
        SELECT type,
          json_extract(payload, '$.toolCallId') AS id,
          json_extract(payload, '$.toolName') AS name,
          substr(json_extract(payload, '$.args.path'), 1, 2049) AS path,
          substr(json_extract(payload, '$.args.command'), 1, 4096) AS command,
          json_extract(payload, '$.isError') AS failed
        FROM events WHERE taskId = ? AND type IN ('tool_start', 'tool_end')
        ORDER BY events.id LIMIT 401
      `).all(task.id);
      const actions = new Map();
      const files = new Map();
      for (const event of events.slice(0, 400)) {
        if (typeof event.id !== 'string' || event.id.length > 200 || !Object.hasOwn(labels, event.name)) continue;
        if (event.type === 'tool_start') {
          const path = workspacePath(task.path, event.path);
          const command = timelinePayload(event.type, { toolName: event.name, args: { command: event.command } }).commandLabel;
          actions.set(event.id, { label: labels[event.name], path, command, state: terminal.has(task.status) ? 'unrecorded' : 'running' });
        } else {
          const action = actions.get(event.id);
          if (!action) continue;
          if (event.failed !== 0 && event.failed !== 1) continue;
          action.state = event.failed === 1 ? 'failed' : 'done';
          if (action.state === 'done' && action.path && ['write', 'edit'].includes(event.name)) {
            const operations = files.get(action.path) ?? new Set();
            operations.add(action.label);
            files.set(action.path, operations);
          }
        }
      }
      const snapshot = db.prepare(`
        SELECT payload FROM events WHERE taskId = ? AND type = 'workspace_changes' ORDER BY id DESC LIMIT 1
      `).get(task.id);
      const changes = snapshot ? JSON.parse(snapshot.payload) : undefined;
      const route = db.prepare(`
        SELECT json_extract(payload, '$.from') AS previous, json_extract(payload, '$.to') AS current,
          json_extract(payload, '$.reason') AS reason
        FROM events WHERE taskId = ? AND type = 'model_route' ORDER BY id DESC LIMIT 1
      `).get(task.id);
      const confirmed = new Map(changes?.files.map(file => [file.path, file.summary]));
      const mergedFiles = changes && !changes.limited ? confirmed : new Map([
        ...[...files].map(([path, operations]) => [path, [...operations].join('、')]), ...confirmed,
      ]);
      return { status: task.status, actions: [...actions.values()], route, limited: events.length > 400,
        filesLimited: changes?.limited === true, workspaceChanges: changes !== undefined,
        files: [...mergedFiles].filter(([path]) => isWorkspaceChangeVisible(path)).map(([path, summary]) => ({ path, summary })) };
    },
    close() {
      db?.close();
      db = undefined;
    },
  };
}
