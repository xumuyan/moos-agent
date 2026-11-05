import { Button, Tag } from 'antd';
import { useSyncExternalStore } from 'react';
import { usePluginRegistry } from '../plugins/slots';

export default function PluginSection() {
  const registry = usePluginRegistry(); useSyncExternalStore(registry.subscribe, registry.version, registry.version);
  return <section><h3>插件</h3><p>当前只启用随应用打包的受信任内置 UI 插件。本地 ZIP/文件夹安装和第三方沙箱属于 P02.7，本页不会启动 Node 或 Web 服务。</p>
    <div className="plugin-list">{registry.list().map(plugin => <div className="plugin-row" key={plugin.id}>
      <div><strong>{plugin.name}</strong><div className="muted">{plugin.id} · {plugin.version} · {plugin.slots.length} 个 Slot</div>{plugin.disabledReason && <Tag color="error">渲染错误已停用</Tag>}</div>
      <Button size="small" onClick={() => registry.setEnabled(plugin.id, !plugin.enabled)}>{plugin.enabled ? '停用' : '启用'}</Button>
    </div>)}</div>
  </section>;
}
