import { useState, type ReactNode } from 'react';
import { Modal } from 'antd';
import GeneralSection from './GeneralSection';
import ModelSection from './ModelSection';
import PermissionSection from './PermissionSection';
import PluginSection from './PluginSection';
import ThemeSection from './ThemeSection';
import PrivacySection from './PrivacySection';
import MobileSection from './MobileSection';
import AdvancedSection from './AdvancedSection';
import type { RuntimeConfig } from '../types';
import { SlotHost } from '../plugins/slots';
import { BUILTIN_THEMES } from '../themes/builtin';
import type { ThemeDefinition } from '../themes/schema';
import type { LocalPluginController } from '../plugins/useLocalPlugins';

const SECTIONS = [
  ['general', '通用'], ['models', '模型服务'], ['permissions', '权限'], ['usage', '用量'], ['plugins', '插件'],
  ['theme', '主题'], ['privacy', '隐私'], ['mobile', '手机连接'], ['advanced', '高级'],
] as const;
type Section = typeof SECTIONS[number][0];

export default function SettingsCenter({ open, onClose, modelContent, usageContent, runtime, onTaskTimeoutChange, activeThemeId = 'default', onThemeApply = () => {}, themes = BUILTIN_THEMES, localPlugins }: {
  open: boolean; onClose: () => void; modelContent: ReactNode; usageContent: ReactNode; runtime: RuntimeConfig;
  onTaskTimeoutChange: (value: number) => Promise<boolean>; activeThemeId?: string; onThemeApply?: (id: string) => void;
  themes?: ThemeDefinition[]; localPlugins?: LocalPluginController;
}) {
  const [active, setActive] = useState<Section>('models');
  const content: Record<Section, ReactNode> = {
    general: <GeneralSection />, models: <ModelSection>{modelContent}</ModelSection>, permissions: <PermissionSection />,
    usage: usageContent, plugins: <PluginSection local={localPlugins} />, theme: <ThemeSection themes={themes} activeId={activeThemeId} onApply={onThemeApply} />, privacy: <PrivacySection />,
    mobile: <MobileSection />, advanced: <AdvancedSection runtime={runtime} onTaskTimeoutChange={onTaskTimeoutChange} />,
  };
  return <Modal title="设置中心" open={open} onCancel={onClose} footer={null} destroyOnHidden width={860}>
    <div className="settings-center">
      <nav className="settings-nav" role="tablist" aria-label="设置分区">
        {SECTIONS.map(([key, label]) => <button key={key} role="tab" aria-selected={active === key} onClick={() => setActive(key)}>{label}</button>)}
      </nav>
      <div className="settings-content" role="tabpanel" aria-label={SECTIONS.find(([key]) => key === active)?.[1]}>{content[active]}<SlotHost slot="settings.section" context={active} /></div>
    </div>
  </Modal>;
}
