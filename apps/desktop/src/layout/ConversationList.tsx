import { useEffect, useState, type CSSProperties } from 'react';
import { Alert, Badge, Input, Modal } from 'antd';
import { IconEditOutlineRegular, IconNewChatOutlineRegular } from '../vendor/dsh/primitives/icons/index';
import rowCss from '../vendor/dsh/sidebar/Rows.module.css';
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
    <nav aria-label="会话历史" style={{'--dsh-workspace-indent':'16px'} as CSSProperties}>{items.map(item => <div key={item.id} className={`${rowCss.sessionRow} ${item.selected ? rowCss.selected : ''}`} role="button" tabIndex={0} aria-label={item.title} title={item.title} onClick={()=>onSelect(item.id)} onKeyDown={event=>{if(event.target===event.currentTarget&&['Enter',' '].includes(event.key)){event.preventDefault();onSelect(item.id);}}}>
      <span className={rowCss.slot} aria-hidden><IconNewChatOutlineRegular size={16} /></span><span className={rowCss.title}>{item.title}</span>{item.running&&<Badge status="processing"/>}
      <span className={rowCss.rowActions}><button type="button" className={rowCss.iconButton} aria-label={`重命名会话 ${item.title}`} disabled={disabled||saving} onClick={event=>{event.stopPropagation();setEditing(item);setTitle(item.title);setFailed(false);}}><IconEditOutlineRegular size={16}/></button></span>
    </div>)}{projectId&&!items.length&&<p>暂无会话，点击 + 新建。</p>}</nav>
    <Modal title="重命名会话" open={!!editing} okText="保存" cancelText="取消" confirmLoading={saving} okButtonProps={{ disabled: disabled || !valid }} cancelButtonProps={{ disabled: saving }} closable={!saving} maskClosable={!saving} keyboard={!saving} onCancel={() => setEditing(undefined)} onOk={() => void save()} destroyOnHidden>
      <label htmlFor="conversation-title">会话名称</label>
      <Input id="conversation-title" autoFocus maxLength={200} value={title} disabled={saving} onChange={event => { setTitle(event.target.value); setFailed(false); }} onPressEnter={() => void save()} />
      {failed && <Alert type="error" message="重命名失败，请重试。" showIcon />}
    </Modal>
  </>;
}
