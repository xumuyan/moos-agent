import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal, Space, Spin } from 'antd';
import { request } from './api';
import { collections } from './useHistory';
import type { ConversationHistory, HistoryCollection, HistoryCursor, Snapshot } from './types';

export default function HistoryControls({ conversationId, page, isOlder, loading, error, onOlder, onLatest }: {
  conversationId: string; page?: ConversationHistory; isOlder: boolean; loading: boolean; error: string; onOlder: () => void; onLatest: () => void;
}) {
  const [viewer, setViewer] = useState<{ loading: boolean; content?: string; error?: string }>();
  const revision = useRef(0);
  useEffect(() => () => { revision.current++; }, []);
  const close = () => { revision.current++; setViewer(undefined); };
  const openRow = async (collection: HistoryCollection, id: HistoryCursor) => {
    const current = ++revision.current;
    setViewer({ loading: true });
    try {
      let offset = 0;
      const chunks: string[] = [];
      let total: number | undefined;
      let rowRevision: string | undefined;
      for (;;) {
        const result = await request<Snapshot>('snapshot', { conversationId, historyRow: { collection, id, offset, ...(rowRevision ? { revision: rowRevision } : {}) } });
        if (current !== revision.current) return;
        const row = result.history?.row;
        if (!row || row.collection !== collection || row.id !== id || row.offset !== offset || typeof row.json !== 'string' || !Number.isSafeInteger(row.totalLength) || row.totalLength < 0 || (total !== undefined && total !== row.totalLength)) throw new Error('完整记录分块无效，请重试');
        if (typeof row.revision !== 'string' || !row.revision || (rowRevision !== undefined && rowRevision !== row.revision)) throw new Error('完整记录版本已变化，请关闭后重试');
        rowRevision = row.revision;
        total = row.totalLength;
        chunks.push(row.json);
        const end = offset + row.json.length;
        if (row.nextOffset === null) {
          if (end !== total) throw new Error('完整记录尚未传输完成，请重试');
          const parsed = JSON.parse(chunks.join(''));
          setViewer({ loading: false, content: JSON.stringify(parsed, null, 2) });
          return;
        }
        if (row.nextOffset !== end || end <= offset || end >= total) throw new Error('完整记录分块游标无效，请重试');
        offset = row.nextOffset;
      }
    } catch (e) {
      if (current === revision.current) setViewer({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  };
  return <>
    {(isOlder || (page && collections.some(collection => page[collection].total > 0 || page[collection].hasMore || page[collection].requiresScopedPage || page[collection].truncatedRows.length > 0))) && <Space wrap className="history-controls">
      <span>{isOlder ? '正在查看历史页（不会被自动刷新覆盖）' : '最近记录'}</span>
      <Button disabled={loading || !page || !collections.some(c => page[c].hasMore && !page[c].requiresScopedPage)} loading={loading} onClick={onOlder}>查看更早记录</Button>
      {isOlder && <Button onClick={onLatest}>返回最新</Button>}
      {page && <span className="muted">消息 {page.messages.total} · 任务 {page.tasks.total} · 事件 {page.events.total}</span>}
    </Space>}
    {error && <Alert type="error" message={error} />}
    {page && collections.flatMap(collection => page[collection].truncatedRows.map(row => <div key={`${collection}:${row.id}`} className="history-truncated">
      <span>超长记录未在当前页展开：{collection} / {row.id}（{row.originalBytes} 字节）</span>{' '}
      <Button size="small" onClick={() => void openRow(collection, row.id)}>查看完整记录</Button>
    </div>))}
    <Modal title="完整记录" open={!!viewer} onCancel={close} footer={<Button onClick={close}>{viewer?.loading ? '取消加载' : '关闭'}</Button>} width={800}>
      {viewer?.loading && <Spin tip="正在分块加载完整记录…"><div style={{ minHeight: 80 }} /></Spin>}
      {viewer?.error && <Alert type="error" message={viewer.error} />}
      {viewer?.content && <pre aria-label="完整记录内容" style={{ maxHeight: '60vh', overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{viewer.content}</pre>}
    </Modal>
  </>;
}
