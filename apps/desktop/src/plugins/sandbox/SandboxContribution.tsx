import { Button, Tag } from 'antd';
import { useEffect, useSyncExternalStore } from 'react';
import type { PluginSlot } from '../manifest';
import type { PluginSandbox } from './runtime';
import type { PluginView } from './schema';

function View({ value, slot, sandbox }: { value: PluginView; slot: PluginSlot; sandbox: PluginSandbox }) {
  if (value.type === 'group') return <span className="sandbox-group">{value.children.map((child, index) => <View key={index} value={child} slot={slot} sandbox={sandbox} />)}</span>;
  if (value.type === 'badge') return <Tag color={value.tone === 'success' ? 'success' : value.tone === 'warning' ? 'warning' : 'default'}>{value.text}</Tag>;
  if (value.type === 'button') return <Button size="small" onClick={() => sandbox.action(slot, value.action)}>{value.text}</Button>;
  return <span className="sandbox-text">{value.text}</span>;
}

export default function SandboxContribution({ sandbox, slot, context }: { sandbox: PluginSandbox; slot: PluginSlot; context?: unknown }) {
  const value = useSyncExternalStore(listener => sandbox.subscribe(slot, listener), () => sandbox.view(slot), () => null);
  useEffect(() => { sandbox.render(slot, context); }, [sandbox, slot, context]);
  return value ? <span className="sandbox-contribution"><View value={value} slot={slot} sandbox={sandbox} /></span> : null;
}
