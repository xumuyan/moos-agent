import { Alert, Button, Popconfirm, Space, Tag } from 'antd';
import { useSyncExternalStore } from 'react';
import { usePluginRegistry } from '../plugins/slots';
import type { LocalPluginController } from '../plugins/useLocalPlugins';
import { BUILTIN_THEMES } from '../themes/builtin';
import type { ThemeDefinition } from '../themes/schema';
import WallpaperSection from './WallpaperSection';

export default function PluginSection({ local, activeThemeId = 'default', onThemeApply = () => {} }: {
  local?: LocalPluginController;
  activeThemeId?: string;
  onThemeApply?: (theme: string | ThemeDefinition) => void;
}) {
  const registry = usePluginRegistry();
  useSyncExternalStore(registry.subscribe, registry.version, registry.version);
  const install = async (kind: 'zip' | 'folder') => {
    const skin = await local?.install(kind);
    if (skin) onThemeApply(skin);
  };

  return <section>
    <h3>插件</h3>
    <p>支持 Moos 皮肤包和 DSH 皮肤中心 v2 原包。安装后立即应用，可在下方切换。</p>
    {local?.error && <Alert type="error" showIcon message={local.error} />}
    {local && <Space wrap>
      <Button loading={local.installing} onClick={() => void install('zip')}>安装 ZIP</Button>
      <Button disabled={local.installing} onClick={() => void install('folder')}>安装文件夹</Button>
    </Space>}
    <h4>内置外观</h4>
    <Space wrap>
      <Button disabled={local?.installing || activeThemeId === 'default'} onClick={() => onThemeApply('default')}>
        {activeThemeId === 'default' ? 'Moos 默认（使用中）' : '恢复默认外观'}
      </Button>
      {BUILTIN_THEMES.map(theme => <Button key={theme.id} disabled={local?.installing || activeThemeId === theme.id} onClick={() => onThemeApply(theme.id)}>
        {theme.name}{activeThemeId === theme.id && '（使用中）'}
      </Button>)}
    </Space>
    {local && <>
      <h4>本地安装包</h4>
      <div className="plugin-list">{local.packages.map(plugin => {
        const isSkin = plugin.pluginType === 'theme';
        const selected = isSkin && activeThemeId === plugin.id;
        const canApply = isSkin && plugin.enabled && local.themes.some(theme => theme.id === plugin.id);
        return <div className="plugin-row" key={plugin.id}>
          <div>
            <strong>{plugin.name}</strong> <Tag>{isSkin ? '皮肤' : '沙箱 UI'}</Tag>
            {isSkin && plugin.manifest.sourceFormat === 'dsh-skin-v2' && <Tag>DSH 静态皮肤</Tag>}
            {selected && <Tag color="success">使用中</Tag>}
            <div className="muted">{plugin.id} · {plugin.version} · {plugin.enabled ? '已启用' : '已停用'}</div>
            <div className="muted">声明权限：{plugin.permissions.length ? plugin.permissions.join('、') : '无'}</div>
          </div>
          <Space wrap>
            {canApply && !selected && <Button size="small" disabled={local.installing} aria-label={`使用 ${plugin.name}`} onClick={() => onThemeApply(plugin.id)}>使用</Button>}
            <Button size="small" disabled={local.installing} onClick={() => void local.setEnabled(plugin.id, !plugin.enabled)}>{plugin.enabled ? '停用' : '启用'}</Button>
            <Popconfirm title="卸载并清除该插件的私有配置？" onConfirm={() => void local.uninstall(plugin.id, true)} okText="清理并卸载" cancelText="取消">
              <Button danger size="small" disabled={local.installing}>卸载</Button>
            </Popconfirm>
          </Space>
        </div>;
      })}{!local.packages.length && <p className="muted">尚未安装本地插件。仅从你信任的来源导入。</p>}</div>
    </>}
    <h4>内置插件</h4>
    <div className="plugin-list">{registry.list().map(plugin => <div className="plugin-row" key={plugin.id}>
      <div><strong>{plugin.name}</strong><div className="muted">{plugin.id} · {plugin.version} · {plugin.slots.length} 个 Slot</div>{plugin.disabledReason && <Tag color="error">渲染错误已停用</Tag>}</div>
      <Button size="small" onClick={() => registry.setEnabled(plugin.id, !plugin.enabled)}>{plugin.enabled ? '停用' : '启用'}</Button>
    </div>)}</div>
    <WallpaperSection legacyOnly />
  </section>;
}
