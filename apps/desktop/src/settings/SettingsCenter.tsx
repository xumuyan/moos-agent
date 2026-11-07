import { useState, type ReactNode } from 'react';
import { Modal } from 'antd';
import '../theme/dsh/settings.css';
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

export default function SettingsCenter({ initialSection = 'models', open, onClose, modelContent, usageContent, runtime, onTaskTimeoutChange, activeThemeId = 'default', onThemeApply = () => {}, themes = BUILTIN_THEMES, localPlugins }: {
  initialSection?: 'models' | 'plugins' | 'usage'; open: boolean; onClose: () => void; modelContent: ReactNode; usageContent: ReactNode; runtime: RuntimeConfig;
  onTaskTimeoutChange: (value: number) => Promise<boolean>; activeThemeId?: string; onThemeApply?: (id: string) => void;
  themes?: ThemeDefinition[]; localPlugins?: LocalPluginController;
}) {
  const [active, setActive] = useState<Section>(initialSection);
  const content: Record<Section, ReactNode> = {
    general: <GeneralSection />, models: <ModelSection>{modelContent}</ModelSection>, permissions: <PermissionSection />,
    usage: usageContent, plugins: <PluginSection local={localPlugins} />, theme: <ThemeSection themes={themes} activeId={activeThemeId} onApply={onThemeApply} />, privacy: <PrivacySection />,
    mobile: <MobileSection />, advanced: <AdvancedSection runtime={runtime} onTaskTimeoutChange={onTaskTimeoutChange} />,
  };
  return <Modal className="settings-dialog dsh-settings-dialog" title="设置中心" open={open} onCancel={onClose} footer={null} destroyOnHidden centered width={800}>
    <div className="settings-center">
      <div className="settings-nav-title" aria-hidden="true">设置中心</div>
      <div className="settings-header" aria-hidden="true" />
      <nav className="settings-nav" role="tablist" aria-label="设置分区" aria-orientation="vertical" onKeyDown={event => {
        const index = SECTIONS.findIndex(([key]) => key === active);
        const next = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? (index + 1) % SECTIONS.length
          : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? (index + SECTIONS.length - 1) % SECTIONS.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? SECTIONS.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault();
        setActive(SECTIONS[next][0]);
        event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
      }}>
        {SECTIONS.map(([key, label]) => <button key={key} id={`settings-tab-${key}`} role="tab" aria-controls="settings-panel" tabIndex={active === key ? 0 : -1} aria-selected={active === key} onClick={() => setActive(key)}>{label}</button>)}
      </nav>
      <div key={active} id="settings-panel" className="settings-content" role="tabpanel" tabIndex={0} aria-labelledby={`settings-tab-${active}`}>{content[active]}<SlotHost slot="settings.section" context={active} /></div>
    </div>
  </Modal>;
}
