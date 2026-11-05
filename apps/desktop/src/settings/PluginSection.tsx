import { Alert, Button, Popconfirm, Space, Tag } from 'antd';
import { useSyncExternalStore } from 'react';
import { usePluginRegistry } from '../plugins/slots';
import type { LocalPluginController } from '../plugins/useLocalPlugins';

export default function PluginSection({ local }: { local?: LocalPluginController }) {
  const registry = usePluginRegistry(); useSyncExternalStore(registry.subscribe, registry.version, registry.version);
  return <section><h3>插件</h3><p>内置插件随应用打包；本地 UI 插件在无 DOM/Tauri 且禁用网络与持久化 API 的独立 Worker 中运行，只能输出白名单声明式 UI。安装不启动 Node 或 Web 服务。</p>
    {local?.error && <Alert type="error" showIcon message={local.error} />}
    {local && <Space wrap><Button onClick={() => void local.install('zip')}>安装 ZIP</Button><Button onClick={() => void local.install('folder')}>安装文件夹</Button></Space>}
    <div className="plugin-list">{registry.list().map(plugin => <div className="plugin-row" key={plugin.id}>
      <div><strong>{plugin.name}</strong><div className="muted">{plugin.id} · {plugin.version} · {plugin.slots.length} 个 Slot</div>{plugin.disabledReason && <Tag color="error">渲染错误已停用</Tag>}</div>
      <Button size="small" onClick={() => registry.setEnabled(plugin.id, !plugin.enabled)}>{plugin.enabled ? '停用' : '启用'}</Button>
    </div>)}</div>{local && <><h4>本地安装包</h4><div className="plugin-list">{local.packages.map(plugin => <div className="plugin-row" key={plugin.id}>
      <div><strong>{plugin.name}</strong> <Tag>{plugin.pluginType === 'theme' ? '皮肤' : '沙箱 UI'}</Tag><div className="muted">{plugin.id} · {plugin.version} · {plugin.enabled ? '已启用' : '默认停用'}</div><div className="muted">声明权限：{plugin.permissions.length ? plugin.permissions.join('、') : '无'}</div></div>
      <Space><Button size="small" onClick={() => void local.setEnabled(plugin.id, !plugin.enabled)}>{plugin.enabled ? '停用' : '启用'}</Button>
        <Popconfirm title="卸载并清除该插件的私有配置？" onConfirm={() => void local.uninstall(plugin.id, true)} okText="清理并卸载" cancelText="取消"><Button danger size="small">卸载</Button></Popconfirm></Space>
    </div>)}{!local.packages.length && <p className="muted">尚未安装本地插件。仅从你信任的来源导入。</p>}</div></>}
  </section>;
}
