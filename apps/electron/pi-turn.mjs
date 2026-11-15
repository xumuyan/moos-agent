import { isWorkspaceChangeVisible } from './plugin/pi-workspace-changes.js';
import { DatabaseSync } from 'node:sqlite';
import { isAbsolute, join, dirname, relative, resolve, sep } from 'node:path';
import { readFileSync, realpathSync, statSync } from 'node:fs';

const labels = {
  read: '读取文件', write: '写入文件', edit: '局部修改', bash: '运行命令',
  bash_escalated: '经审批运行命令', grep: '搜索内容', find: '查找文件', ls: '查看目录',
  desktop_begin: '开始桌面事务', desktop_end: '验证并结束桌面事务',
  desktop_permissions: '查询桌面权限', desktop_screenshot: '截取屏幕', desktop_click: '点击鼠标',
  desktop_type: '键入文本', desktop_key: '按键/快捷键', desktop_scroll: '滚动',
  desktop_displays: '列出显示器', desktop_windows: '列出窗口', desktop_app: '启动/切换应用',
};
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'interrupted']);

function workspacePath(cwd, path) {
  if (typeof path !== 'string' || !path || path.length > 2048 || path.startsWith('~') || /[\x00-\x1f\x7f]/.test(path)) return;
  const name = relative(cwd, resolve(cwd, path));
  if (name === '..' || name.startsWith('..' + sep) || isAbsolute(name)) return;
  return name || '.';
}

export function createPiTurnReader(dbPath, timelinePayload, { screenshotsRoot, maxShotBytes = 25 * 1024 * 1024, shotLimit = 12 } = {}) {
  // 截图默认位于应用数据目录 sessions/screenshots 下；root 不存在或越界一律拒绝读取。
  const shotsRoot = screenshotsRoot ?? join(dirname(dbPath), 'sessions', 'screenshots');
  const shotPattern = /^\d{14}-[0-9a-f]{12}$/;
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
      // 排队位次只在本项目内计算：项目间互不等待（全局并发槽由调度器分配，默认四个），
      // 因此跨项目的排队/执行任务不计入位次；projectRunning 表示本项目是否有任务正在执行，
      // 用于区分「等同项目上一任务完成」与「等空闲执行位」两种等待原因。
      const queueInfo = task.status === 'queued'
        ? {
            queueAhead: db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE status = 'queued' AND projectId = (SELECT projectId FROM tasks WHERE id = ?) AND rowid < (SELECT rowid FROM tasks WHERE id = ?)").get(task.id, task.id).n,
            projectRunning: db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE status = 'running' AND projectId = (SELECT projectId FROM tasks WHERE id = ?)").get(task.id).n > 0,
          }
        : { queueAhead: undefined, projectRunning: undefined };

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
      // 桌面截图列表：只含截图 ID 与尺寸，不含路径/图像内容；聊天缩略图按 ID 经受限 IPC 另取。
      const shotEvents = db.prepare(`
        SELECT payload FROM events WHERE taskId = ? AND type = 'desktop_screenshot' ORDER BY id DESC LIMIT ?
      `).all(task.id, shotLimit);
      const shots = shotEvents.flatMap(event => {
        let payload;
        try { payload = JSON.parse(event.payload); } catch { return []; }
        if (typeof payload?.shotId !== 'string' || !shotPattern.test(payload.shotId)) return [];
        const width = Number.isSafeInteger(payload.imageWidth) && payload.imageWidth > 0 && payload.imageWidth <= 20000 ? payload.imageWidth : undefined;
        const height = Number.isSafeInteger(payload.imageHeight) && payload.imageHeight > 0 && payload.imageHeight <= 20000 ? payload.imageHeight : undefined;
        return [{ id: payload.shotId, width, height }];
      }).reverse();
      const route = db.prepare(`
        SELECT json_extract(payload, '$.from') AS previous, json_extract(payload, '$.to') AS current,
          json_extract(payload, '$.reason') AS reason
        FROM events WHERE taskId = ? AND type = 'model_route' ORDER BY id DESC LIMIT 1
      `).get(task.id);
      // M06 桌面队列状态：仅在进行中（queued/running 相位）时显示；结束相位由工具动作行呈现。
      const desktopEvent = db.prepare(`
        SELECT json_extract(payload, '$.phase') AS phase, substr(json_extract(payload, '$.label'), 1, 120) AS label,
          json_extract(payload, '$.queueAhead') AS queueAhead
        FROM events WHERE taskId = ? AND type = 'desktop_action' ORDER BY id DESC LIMIT 1
      `).get(task.id);
      const desktop = !terminal.has(task.status) && desktopEvent && (desktopEvent.phase === 'queued' || desktopEvent.phase === 'running')
        ? { phase: desktopEvent.phase, label: desktopEvent.label, queueAhead: desktopEvent.queueAhead }
        : undefined;
      // Only finite enums, IDs and DAG edges cross IPC. User goals, raw
      // member output, model verdict prose and arbitrary paths never do.
      const submission = db.prepare(`SELECT json_extract(payload, '$.mode') AS mode
        FROM events WHERE taskId = ? AND type = 'task_submission' ORDER BY id DESC LIMIT 1`).get(task.id);
      let team;
      if (submission?.mode === 'team') {
        const states = db.prepare(`SELECT payload FROM events
          WHERE taskId = ? AND type = 'team_state' ORDER BY id LIMIT 129`).all(task.id);
        const nodes = new Map(), attempts = new Map();
        const phases = new Set(['planning', 'planned', 'queued', 'running', 'done', 'blocked', 'completed', 'summarizing', 'succeeded', 'failed']);
        let phase = 'queued', member;
        const id = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(value);
        for (const row of states.slice(0, 128)) {
          let state; try { state = JSON.parse(row.payload); } catch { continue; }
          if (state?.teamId !== task.id || !phases.has(state.phase)) continue;
          const role = ['captain', 'implementer', 'verifier'].includes(state.member) ? state.member : undefined;
          if (state.nodeId !== undefined) {
            const node = nodes.get(state.nodeId);
            if (!node || node.role !== role) continue;
            const attempt = attempts.get(node.id);
            if (state.phase === 'queued') {
              if (attempt) continue;
            } else if (state.phase === 'running') {
              // This runtime has one attempt per node; explicit retry creates
              // a new parent task. Never replace an accepted attempt in-place.
              if (attempt || typeof state.attemptId !== 'string' || state.attemptId.length !== 36
                || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(state.attemptId)) continue;
              attempts.set(node.id, { id: state.attemptId, done: false });
              node.state = 'running';
            } else if (['done', 'completed', 'blocked'].includes(state.phase)) {
              if (!attempt || attempt.id !== state.attemptId || node.state !== 'running') continue;
              if (state.phase === 'done') {
                if (attempt.done) continue;
                attempt.done = true;
              } else {
                if (!attempt.done) continue;
                node.state = state.phase;
                const outcome = state.outcome;
                const codes = role === 'verifier'
                  ? state.phase === 'completed' ? ['verified'] : ['tool_failure', 'missing_verdict', 'rejected']
                  : state.phase === 'completed' ? ['member_finished'] : [];
                if (outcome?.version === 1 && codes.includes(outcome.code)
                  && ['toolsSucceeded', 'toolsFailed', 'evidenceCount'].every(key =>
                    Number.isSafeInteger(outcome[key]) && outcome[key] >= 0 && outcome[key] <= 10000)
                  && outcome.evidenceCount <= outcome.toolsSucceeded
                  && (outcome.code !== 'verified' || outcome.evidenceCount > 0 && outcome.toolsFailed === 0)
                  && (outcome.code !== 'tool_failure' || outcome.toolsFailed > 0)) {
                  node.outcome = { code: outcome.code, toolsSucceeded: outcome.toolsSucceeded,
                    toolsFailed: outcome.toolsFailed, evidenceCount: outcome.evidenceCount };
                }
              }
            } else continue;
          } else if (['queued', 'completed', 'blocked'].includes(state.phase)
            || ['running', 'done'].includes(state.phase) && role !== 'captain') continue;
          phase = state.phase;
          member = role;
          if (phase === 'planned' && Array.isArray(state.tasks) && !nodes.size) {
            for (const node of state.tasks.slice(0, 6)) {
              if (!node || !id(node.id) || !['implementer', 'verifier'].includes(node.role) || !Array.isArray(node.dependsOn)) continue;
              nodes.set(node.id, { id: node.id, role: node.role, dependsOn: node.dependsOn.filter(id).slice(0, 6), state: 'queued' });
            }
          }
        }
        // Parent lifecycle is authoritative, including cancel/deadline/restart.
        if (terminal.has(task.status)) phase = task.status;
        // Explain actual failed dependencies, not guessed model prose. A
        // cancelled/running legacy node without a correlated receipt stays unknown.
        const blockedBy = new Map([...nodes.values()].filter(node => node.state === 'blocked').map(node => [node.id, [node.id]]));
        for (let i = 0; i < nodes.size; i++) for (const node of nodes.values()) {
          if (node.state !== 'queued') continue;
          const ancestors = [...new Set(node.dependsOn.flatMap(id => blockedBy.get(id) ?? []))];
          if (ancestors.length) blockedBy.set(node.id, ancestors);
        }
        team = { phase, member, nodes: [...nodes.values()].map(node => ({ ...node,
          ...(node.state === 'queued' && blockedBy.has(node.id) && { waitingOn: blockedBy.get(node.id) }) })), limited: states.length > 128 };
      }
      const confirmed = new Map(changes?.files.map(file => [file.path, file.summary]));
      const mergedFiles = changes && !changes.limited ? confirmed : new Map([
        ...[...files].map(([path, operations]) => [path, [...operations].join('、')]), ...confirmed,
      ]);
      return { status: task.status, queueAhead: queueInfo.queueAhead, projectRunning: queueInfo.projectRunning, actions: [...actions.values()], route, desktop, shots, team, limited: events.length > 400,
        filesLimited: changes?.limited === true, workspaceChanges: changes !== undefined,
        files: [...mergedFiles].filter(([path]) => isWorkspaceChangeVisible(path)).map(([path, summary]) => ({ path, summary })) };
    },
    // 受限截图读取：先验证会话归属，再在事件记录的 savedTo 中找该 ID，
    // realpath 归一到默认截图根目录内、大小与 PNG 魔数校验后才返回字节；任何一步失败返回 null。
    shot(sessionId, shotId) {
      if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(sessionId)) return null;
      if (typeof shotId !== 'string' || !shotPattern.test(shotId)) return null;
      const conversation = db?.prepare('SELECT value FROM settings WHERE key = ?').get('dsh-session:' + sessionId);
      if (!conversation?.value) return null;
      const rows = db.prepare(`
        SELECT payload FROM events WHERE type = 'desktop_screenshot'
          AND taskId IN (SELECT id FROM tasks WHERE conversationId = ?)
        ORDER BY id DESC LIMIT 96
      `).all(conversation.value);
      let claimed;
      for (const row of rows) {
        let payload;
        try { payload = JSON.parse(row.payload); } catch { continue; }
        if (typeof payload?.shotId === 'string' && payload.shotId === shotId
          && typeof payload.savedTo === 'string' && payload.savedTo.endsWith(shotId + '.png')) {
          claimed = payload.savedTo;
          break;
        }
      }
      if (!claimed || !isAbsolute(claimed)) return null;
      let real;
      let size = 0;
      try {
        real = realpathSync(claimed);
        const rel = relative(realpathSync(shotsRoot), real);
        if (rel === '' || rel.startsWith('..' + sep) || isAbsolute(rel)) return null;
        size = statSync(real).size;
        if (!Number.isSafeInteger(size) || size < 8 || size > maxShotBytes) return null;
      } catch {
        return null;
      }
      const bytes = readFileSync(real);
      if (bytes.length !== size
        || !bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return null;
      return { id: shotId, mime: 'image/png', data: bytes };
    },
    close() {
      db?.close();
      db = undefined;
    },
  };
}
