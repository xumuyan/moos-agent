import { useState, type ReactNode } from 'react';
import SettingsPanel from '../vendor/dsh/settings/SettingsPanel';
import { IconSettingsOutlineMedium, IconDataOutlineMedium, IconPersonalizationOutlineMedium, IconUserOutlineMedium, IconArchiveOutlineMedium } from '../vendor/dsh/primitives/icons/index';
import GeneralSection from './GeneralSection';
import ModelSection from './ModelSection';
import PermissionSection from './PermissionSection';
import PluginSection from './PluginSection';
import PrivacySection from './PrivacySection';
import MobileSection from './MobileSection';
import AdvancedSection from './AdvancedSection';
import type { RuntimeConfig } from '../types';
import { SlotHost } from '../plugins/slots';
import type { ThemeDefinition } from '../themes/schema';
import type { LocalPluginController } from '../plugins/useLocalPlugins';

const SECTIONS = [
  ['general', '通用'], ['models', '模型服务'], ['permissions', '权限'], ['usage', '用量'], ['plugins', '插件'],
  ['privacy', '隐私'], ['mobile', '手机连接'], ['advanced', '高级'],
] as const;
const SECTION_ICONS = [IconSettingsOutlineMedium, IconDataOutlineMedium, IconSettingsOutlineMedium, IconDataOutlineMedium, IconPersonalizationOutlineMedium, IconUserOutlineMedium, IconArchiveOutlineMedium, IconSettingsOutlineMedium];
type Section = typeof SECTIONS[number][0];

export default function SettingsCenter({ initialSection = 'models', open, onClose, modelContent, usageContent, runtime, onTaskTimeoutChange, activeThemeId, onThemeApply, localPlugins }: {
  initialSection?: 'models' | 'plugins' | 'usage'; open: boolean; onClose: () => void; modelContent: ReactNode; usageContent: ReactNode; runtime: RuntimeConfig;
  onTaskTimeoutChange: (value: number) => Promise<boolean>; activeThemeId?: string; onThemeApply?: (theme: string | ThemeDefinition) => void;
  localPlugins?: LocalPluginController;
}) {
  const [active, setActive] = useState<Section>(initialSection);
  const content: Record<Section, ReactNode> = {
    general: <GeneralSection />, models: <ModelSection>{modelContent}</ModelSection>, permissions: <PermissionSection />,
    usage: usageContent, plugins: <PluginSection local={localPlugins} activeThemeId={activeThemeId} onThemeApply={onThemeApply} />, privacy: <PrivacySection />,
    mobile: <MobileSection />, advanced: <AdvancedSection runtime={runtime} onTaskTimeoutChange={onTaskTimeoutChange} />,
  };
  if (!open) return null;
  return <SettingsPanel rows={SECTIONS.map(([id,label],index) => { const Icon=SECTION_ICONS[index]; return {id,label,icon:<Icon size={16} />}; })}
    activeId={active} onSelect={id => setActive(id as Section)} onClose={onClose}
    renderContent={id => <>{content[id as Section]}<SlotHost slot="settings.section" context={id} /></>} />;
}
