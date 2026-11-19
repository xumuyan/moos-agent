import type { ModelChoice } from './desktop-model-picker';

export const turnQueueLimit = 4;
const viewLimit = 32;
export type QueuedTurn = Readonly<{ id: number; text: string; choice?: ModelChoice }>;
const empty: readonly QueuedTurn[] = [];

export const validTurnText = (text: string) => !!text.trim() && !text.includes('\0') && new TextEncoder().encode(text).length <= 4096;
export type TurnActivity = { busy: boolean; stopping: boolean; drained: boolean; error: string; task: { status: string } | null };
export function nextTurnReady(activity: TurnActivity | undefined, resume = false) {
  return !!activity && !activity.busy && !activity.stopping && !activity.error && activity.drained &&
    (activity.task?.status === 'succeeded' ||
      (resume && ['failed', 'cancelled', 'interrupted'].includes(activity.task?.status ?? '')));
}

// Unsent text lives only in this view. Queue rows never write files, submit or replay by themselves.
export function turnQueue() {
  const scopes = new Map<string, readonly QueuedTurn[]>();
  const paused = new Set<string>();
  let nextID = 0, total = 0;
  const rows = (key: string) => scopes.get(key) ?? empty;
  const set = (key: string, list: readonly QueuedTurn[]) => {
    total += list.length - rows(key).length;
    if (list.length) scopes.set(key, list);
    else { scopes.delete(key); paused.delete(key); }
  };
  return {
    rows,
    full: (key: string) => rows(key).length >= turnQueueLimit || total >= viewLimit,
    enqueue(key: string, text: string, choice?: ModelChoice) {
      if (!key || !validTurnText(text) || rows(key).length >= turnQueueLimit || total >= viewLimit) return false;
      set(key, [...rows(key), { id: ++nextID, text, choice: choice && { ...choice } }]);
      return true;
    },
    edit(key: string, id: number, text: string) {
      if (!validTurnText(text) || !rows(key).some(row => row.id === id)) return false;
      set(key, rows(key).map(row => row.id === id ? { ...row, text } : row));
      return true;
    },
    remove(key: string, id: number) { set(key, rows(key).filter(row => row.id !== id)); },
    pause(key: string) { if (rows(key).length) paused.add(key); },
    paused: (key: string) => paused.has(key),
    take(key: string, activity: TurnActivity | undefined, resume: boolean) {
      const head = rows(key)[0];
      if (!head || !nextTurnReady(activity, resume) || (paused.has(key) && !resume)) return undefined;
      paused.delete(key);
      set(key, rows(key).slice(1));
      return head;
    },
    clear() { scopes.clear(); paused.clear(); total = 0; },
  };
}
