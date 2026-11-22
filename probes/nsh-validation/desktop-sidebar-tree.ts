import type { Task } from './desktop-contract';

// Current-page observation, not CSS export. Only active project's sessions are
// available from the six-method bridge; never invent another project's history.
export const sidebarTree = {
  newSessionHeight: 48,
  newSessionMarginTop: -2, // parent gap10 => 8pt below the brand plate
  navigationRowHeight: 38,
  workspaceHeight: 38,
  projectHeight: 54,
  sessionHeight: 36,
  projectTextRightInset: 36, // preserve ribbon end-cap safety from scroll_fix
  branchX: 8,
  branchWidth: 10,
} as const;
export function projectTreeHeight(selected: boolean, sessionCount: number) {
  return sidebarTree.projectHeight + (selected ? Math.max(0, sessionCount) * sidebarTree.sessionHeight : 0);
}

export function sessionTreeState(
  row: { projectId: string; id: string },
  selected: { projectId: string; sessionId: string },
  conversation?: { scope: { projectId: string; sessionId: string }; busy: boolean },
) {
  return {
    selected: selected.projectId === row.projectId && selected.sessionId === row.id,
    working: conversation?.scope.projectId === row.projectId && conversation.scope.sessionId === row.id && conversation.busy,
  };
}


export type SessionCompletion = 'succeeded' | 'failed';

export function sessionCompletions() {
  let unread = new Map<string, SessionCompletion>();
  const observed = new WeakMap<object, string>();
  return {
    snapshot: () => unread,
    restore(saved: string | null) {
      if (saved === null) return;
      const entries: unknown = JSON.parse(saved);
      if (!Array.isArray(entries)) return;
      unread = new Map(entries.filter((entry): entry is [string, SessionCompletion] =>
        Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string' &&
        (entry[1] === 'succeeded' || entry[1] === 'failed')));
    },
    observe(conversation: { task: Task | null; drained: boolean; busy: boolean; error: string }) {
      const { task, drained, busy, error } = conversation;
      if (!task || !drained || busy || error || observed.get(conversation) === task.id) return;
      observed.set(conversation, task.id);
      if (task.status !== 'succeeded' && task.status !== 'failed') return;
      const key = JSON.stringify([task.projectId, task.sessionId]);
      if (unread.get(key) !== task.status) unread = new Map(unread).set(key, task.status);
    },
    view(key: string) {
      if (!unread.has(key)) return;
      unread = new Map(unread);
      unread.delete(key);
    },
  };
}
