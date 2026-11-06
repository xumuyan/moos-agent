import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Input, Modal, Tooltip } from 'antd';
import { EditOutlined, MessageOutlined } from '@ant-design/icons';
import type { ConversationView } from '../ui-adapter/types';

export default function ConversationList({ items, projectId, disabled, onSelect, onRename }: {
  items: ConversationView[]; projectId: string; disabled: boolean;
  onSelect: (id: string) => void; onRename: (id: string, title: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<ConversationView>();
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setEditing(undefined); }, [projectId]);
  const valid = !!title.trim() && title.trim().length <= 200 && !/[\u0000-\u001f\u007f]/.test(title.trim());
  const save = async () => {
    if (!editing || saving || disabled || !valid) return;
    const id = editing.id;
    setSaving(true); setFailed(false);
    try {
      if (await onRename(id, title.trim())) setEditing(current => current?.id === id ? undefined : current);
      else setFailed(true);
    } catch { setFailed(true); }
    finally { setSaving(false); }
  };
  return <>
    <nav className="conversations" aria-label="会话历史">{items.map(item => <div key={item.id} className={`conversation-item ${item.selected ? 'selected' : ''}`}>
      <button aria-label={item.title} title={item.title} className={`conversation-button ${item.selected ? 'selected' : ''}`} onClick={() => onSelect(item.id)}><MessageOutlined /><span>{item.title}</span>{item.running && <Badge status="processing" />}</button>
      <Tooltip title="重命名"><Button type="text" size="small" className="conversation-rename" icon={<EditOutlined />} aria-label={`重命名会话 ${item.title}`} disabled={disabled || saving} onClick={() => { setEditing(item); setTitle(item.title); setFailed(false); }} /></Tooltip>
    </div>)}{projectId && !items.length && <p className="sidebar-hint">暂无会话，点击 + 新建。</p>}</nav>
    <Modal title="重命名会话" open={!!editing} okText="保存" cancelText="取消" confirmLoading={saving} okButtonProps={{ disabled: disabled || !valid }} cancelButtonProps={{ disabled: saving }} closable={!saving} maskClosable={!saving} keyboard={!saving} onCancel={() => setEditing(undefined)} onOk={() => void save()} destroyOnHidden>
      <label htmlFor="conversation-title">会话名称</label>
      <Input id="conversation-title" autoFocus maxLength={200} value={title} disabled={saving} onChange={event => { setTitle(event.target.value); setFailed(false); }} onPressEnter={() => void save()} />
      {failed && <Alert type="error" message="重命名失败，请重试。" showIcon />}
    </Modal>
  </>;
}
