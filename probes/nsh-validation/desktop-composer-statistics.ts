import type { DesktopTaskStatistics, Scope, Task } from './desktop-contract';

type Activity = { scope: Scope; task: Task | null; cursor: string | null; drained: boolean; error: string };
const key = (scope: Scope) => JSON.stringify([scope.projectId, scope.sessionId]);
const object = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const finiteRate = (value: unknown) => typeof value === 'number' && value >= 0 && value <= 1 ? value : null;
const blank: DesktopTaskStatistics = { toolSteps: null, elapsedMs: null, toolMs: null, cacheHitRate: null, context: null };
export function readTaskStatistics(value: unknown): DesktopTaskStatistics {
  const data = object(value), context = object(data?.context);
  const tokens = count(context?.tokens), window = count(context?.window);
  return { toolSteps: count(data?.toolSteps), elapsedMs: count(data?.elapsedMs), toolMs: count(data?.toolMs),
    cacheHitRate: finiteRate(data?.cacheHitRate), context: tokens !== null && window ? { tokens, window } : null };
}
export type ComposerStatistics = DesktopTaskStatistics & { rounds: number | null };
const empty: ComposerStatistics = { ...blank, rounds: null };

export function composerStatistics() {
  const pending = new Map<string, { id: string; cursor: string; statistics: DesktopTaskStatistics }>();
  const seen = new Map<string, { ids: Set<string>; summary: ComposerStatistics }>();
  return {
    stage(scope: Scope & { taskId: string }, value: unknown) {
      const k = key(scope), page = object(value), task = object(page?.task);
      pending.delete(k);
      if (page?.terminal !== true || page.hasMore !== false || typeof page.cursor !== 'string' || page.cursor.length > 64 ||
        task?.projectId !== scope.projectId || task?.sessionId !== scope.sessionId || task?.id !== scope.taskId) return;
      pending.set(k, { id: scope.taskId, cursor: page.cursor, statistics: readTaskStatistics(page.statistics) });
    },
    confirm(activities: Iterable<Activity>) {
      // DesktopController commits a validated page before notifying the view. A
      // rejected page cannot populate the strip or influence queue/send gating.
      for (const c of activities) {
        const k = key(c.scope), next = pending.get(k);
        if (!next) continue;
        if (c.error) { pending.delete(k); continue; }
        if (!c.drained || c.task?.id !== next.id || c.cursor !== next.cursor) continue;
        pending.delete(k);
        const prior = seen.get(k);
        const ids = prior?.ids ?? new Set<string>();
        if (ids.has(next.id)) continue;
        ids.add(next.id);
        const earlierSteps = prior ? prior.summary.toolSteps : 0;
        const latestSteps = next.statistics.toolSteps;
        const toolSteps = earlierSteps === null || latestSteps === null ? null : count(earlierSteps + latestSteps);
        seen.set(k, { ids, summary: { ...next.statistics, rounds: ids.size, toolSteps } });
      }
    },
    read(scope?: Scope): ComposerStatistics { return scope ? seen.get(key(scope))?.summary ?? empty : empty; },
    clear() { pending.clear(); seen.clear(); },
  };
}

export const showCount = (n: number | null) => n === null ? '—' : String(n);
export const showRate = (n: number | null) => n === null ? '—' : `${Number((n * 100).toFixed(1))}%`;
export const showTime = (ms: number | null) => ms === null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
const tokenCount = new Intl.NumberFormat('en-US');
export const showContext = (c: DesktopTaskStatistics['context']) => c ? `${tokenCount.format(c.tokens)} / ${tokenCount.format(c.window)}` : '—';
