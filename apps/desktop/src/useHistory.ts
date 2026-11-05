import { useEffect, useRef, useState } from 'react';
import { request } from './api';
import type { HistoryCollection, HistoryCursor, Snapshot } from './types';

export const collections: HistoryCollection[] = ['messages', 'tasks', 'events'];
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export function useHistory(data: Snapshot, conversationId: string) {
  const [older, setOlder] = useState<{ id: string; data: Snapshot }>();
  const [scoped, setScoped] = useState<{ id: string; data: Snapshot }>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const selection = useRef(conversationId);
  selection.current = conversationId;
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setOlder(undefined); setScoped(undefined); setLoading(false); setError('');
    return () => { generation.current++; };
  }, [conversationId]);
  const globalPage = data.history?.pages.find(p => p.conversationId === conversationId);
  const requiresScoped = !!globalPage && collections.some(c => globalPage[c].requiresScopedPage);
  useEffect(() => {
    if (!conversationId || !requiresScoped) return;
    let stale = false;
    void request<Snapshot>('snapshot', { conversationId }).then(result => {
      if (!stale && selection.current === conversationId) { setScoped({ id: conversationId, data: result }); setError(''); }
    }).catch(e => { if (!stale) setError(errorText(e)); });
    return () => { stale = true; };
  }, [data, conversationId, requiresScoped]);
  const isOlder = older?.id === conversationId;
  const visible = isOlder ? older.data : scoped?.id === conversationId && requiresScoped ? scoped.data : data;
  const page = visible.history?.pages.find(p => p.conversationId === conversationId);
  const loadOlder = async () => {
    if (!page || loading) return;
    const current = ++generation.current;
    const id = conversationId;
    const before: Partial<Record<HistoryCollection, HistoryCursor>> = {};
    for (const collection of collections) {
      // Keep exhausted collections at their boundary, rather than restarting them.
      if (page[collection].before !== null) before[collection] = page[collection].before!;
    }
    setLoading(true); setError('');
    try {
      const result = await request<Snapshot>('snapshot', { conversationId: id, before });
      if (current === generation.current && selection.current === id) setOlder({ id, data: result });
    } catch (e) { if (current === generation.current && selection.current === id) setError(errorText(e)); }
    finally { if (current === generation.current && selection.current === id) setLoading(false); }
  };
  const latest = () => { generation.current++; setOlder(undefined); setLoading(false); setError(''); };
  const recent = scoped?.id === conversationId && requiresScoped ? scoped.data : data;
  return { visible, recent, page, isOlder, loading, error, loadOlder, latest };
}
