import { useEffect, useRef, useState } from 'react';
import { request } from '../api';
import type { AgentEvent, Task, TaskTimelinePage } from '../types';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_EVENTS = 10000;
// All mounted turns share one reader. A startup burst must not fill the native
// host's bounded write queue and terminate the shared task service.
let reader: Promise<void> = Promise.resolve();
async function readTimeline(params: Record<string, unknown>, stale: () => boolean) {
  const previous = reader;
  let release!: () => void;
  reader = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try {
    if (stale()) return undefined;
    return await request<{ taskTimeline?: TaskTimelinePage }>('snapshot', params);
  } finally { release(); }
}
type Cache = { id: string; events: AgentEvent[]; after: number; bytes: number; limited: boolean; hasMore: boolean; loaded: boolean; unavailable?: boolean };
const empty = (id: string): Cache => ({ id, events: [], after: 0, bytes: 0, limited: false, hasMore: false, loaded: false });

export function useTaskTimeline(task: Task, snapshotEvents: AgentEvent[], enabled: boolean) {
  const cache = useRef<Cache>(empty(task.id));
  const [view, setView] = useState<Cache>(cache.current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const requested = useRef('');
  useEffect(() => {
    if (cache.current.id !== task.id) { cache.current = empty(task.id); setView(cache.current); setError(''); setBusy(false); requested.current = ''; }
    if ((!enabled && requested.current !== task.id) || cache.current.unavailable) return;
    let stale = false;
    setBusy(true);
    const load = async () => {
      try {
        for (let pageIndex = 0; pageIndex < 32; pageIndex++) {
          const current = cache.current;
          if (current.bytes >= MAX_BYTES || current.events.length >= MAX_EVENTS) { cache.current = { ...current, limited: true, hasMore: false }; setView(cache.current); break; }
          const result = await readTimeline({ conversationId: task.conversationId, taskTimeline: { taskId: task.id, after: current.after } }, () => stale);
          if (stale) return;
          const page = result?.taskTimeline;
          // Older adapters and test bridges may not implement the optional view yet.
          if (!page) { cache.current = { ...current, unavailable: true, loaded: true }; setView(cache.current); return; }
          if (page.version !== 1 || page.taskId !== task.id || page.projectId !== task.projectId || page.conversationId !== task.conversationId ||
              !Array.isArray(page.events) || page.events.length > 200 || typeof page.hasMore !== 'boolean' || typeof page.limited !== 'boolean' ||
              !Number.isSafeInteger(page.nextAfter) || page.nextAfter < current.after || (page.hasMore && page.nextAfter <= current.after) ||
              page.events.some((event, index) => event.taskId !== task.id || event.projectId !== task.projectId || event.conversationId !== task.conversationId ||
                !Number.isSafeInteger(Number(event.id)) || Number(event.id) <= current.after || Number(event.id) > page.nextAfter ||
                (index > 0 && Number(event.id) <= Number(page.events[index - 1].id)))) throw new Error('Invalid timeline');
          const bytes = new TextEncoder().encode(JSON.stringify(page.events)).byteLength;
          const fits = current.bytes + bytes <= MAX_BYTES && current.events.length + page.events.length <= MAX_EVENTS;
          cache.current = fits ? { ...current, events: [...current.events, ...page.events], after: page.nextAfter,
            bytes: current.bytes + bytes, limited: current.limited || page.limited, hasMore: page.hasMore, loaded: true }
            : { ...current, limited: true, hasMore: false, bytes: MAX_BYTES };
          setView(cache.current); setError('');
          if (!fits || !page.hasMore) break;
        }
      } catch { if (!stale) setError('完整过程加载失败，可重试。'); }
      finally { if (!stale) setBusy(false); }
    };
    void load();
    return () => { stale = true; };
  }, [task.id, task.projectId, task.conversationId, task.updatedAt, task.status, enabled, revision]);
  const current = view.id === task.id ? view : empty(task.id);
  const combined = new Map(current.events.map(event => [String(event.id), event]));
  for (const event of snapshotEvents) if (event.taskId === task.id && event.projectId === task.projectId && event.conversationId === task.conversationId && !combined.has(String(event.id))) combined.set(String(event.id), event);
  const events = [...combined.values()].sort((a, b) => {
    const left = Number(a.id), right = Number(b.id);
    return Number.isFinite(left) && Number.isFinite(right) ? left - right : 0;
  });
  return { events, busy: view.id === task.id && busy, error: view.id === task.id ? error : '', limited: current.limited, hasMore: current.hasMore, loaded: current.loaded,
    load: () => { requested.current = task.id; setRevision(value => value + 1); } };
}
