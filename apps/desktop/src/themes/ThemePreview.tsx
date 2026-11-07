import type { CSSProperties } from 'react';
import { validateTheme, type ThemeDefinition } from './schema';
import css from './ThemePreview.module.css';

const VARIABLES = { accent: '--moos-accent', accentSoft: '--moos-accent-soft', border: '--moos-border', panel: '--moos-panel', sidebar: '--moos-sidebar', muted: '--moos-muted', radius: '--moos-radius', rightPanelWidth: '--moos-right-panel-width' } as const;
export default function ThemePreview({ theme }: { theme: ThemeDefinition }) {
  const safe = validateTheme(theme); const style: Record<string, string> = {};
  for (const [key, value] of Object.entries(safe.tokens)) style[VARIABLES[key as keyof typeof VARIABLES]] = value;
  const background = safe.backgroundMedia;
  if (background) {
    style['--preview-mask'] = String(background.maskOpacity);
    style['--preview-surface'] = `${background.surfaceOpacity * 100}%`;
    style['--preview-blur'] = `${background.blur}px`;
  }
  return <div className={`theme-preview${background ? ` ${css.imagePreview}` : ''}`} style={style as CSSProperties} aria-label={`预览 ${safe.name}`}>
    {background && <img src={background.src} alt="皮肤背景预览" />}
    <aside><span /> <span /> <span /></aside><main><strong>{safe.name}</strong><p>预览不会保存，应用后才改变主界面。</p><button type="button">示例按钮</button></main>
  </div>;
}
