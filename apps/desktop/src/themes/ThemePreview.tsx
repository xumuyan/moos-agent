import type { CSSProperties } from 'react';
import { validateTheme, type ThemeDefinition } from './schema';

const VARIABLES = { accent: '--moos-accent', accentSoft: '--moos-accent-soft', border: '--moos-border', panel: '--moos-panel', sidebar: '--moos-sidebar', muted: '--moos-muted', radius: '--moos-radius', rightPanelWidth: '--moos-right-panel-width' } as const;
export default function ThemePreview({ theme }: { theme: ThemeDefinition }) {
  const safe = validateTheme(theme); const style: Record<string, string> = {};
  for (const [key, value] of Object.entries(safe.tokens)) style[VARIABLES[key as keyof typeof VARIABLES]] = value;
  return <div className="theme-preview" style={style as CSSProperties} aria-label={`预览 ${safe.name}`}>
    <aside><span /> <span /> <span /></aside><main><strong>{safe.name}</strong><p>预览不会保存，应用后才改变主界面。</p><button type="button">示例按钮</button></main>
  </div>;
}
