import { Tag } from 'antd';
import { createPluginRegistry } from '../plugins/registry';

export function createBuiltinPluginRegistry() {
  const registry = createPluginRegistry();
  registry.register({ id: 'dev.moos.usage-insights', name: '用量口径助手', version: '1.0.0', type: 'ui',
    moosVersion: '^0.1.0', entry: 'builtin:usage-insights', slots: ['composer.trailing', 'settings.section', 'usage.metric'], permissions: ['ui:slots', 'theme:read'] }, [
    { slot: 'composer.trailing', render: () => <span className="plugin-composer-note">用量只读取服务商返回值</span> },
    { slot: 'settings.section', render: context => context === 'plugins' ? <div className="builtin-plugin-note"><Tag color="success">内置</Tag>固定 Slot 运行于 Moos WebView，不启动插件服务。</div> : null },
    { slot: 'usage.metric', render: () => <div className="usage-metric plugin-usage-metric"><span>数据口径</span><strong>服务商 Usage</strong><small>缺失字段不估算</small></div> },
  ]);
  return registry;
}
