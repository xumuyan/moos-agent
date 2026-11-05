import { validateTheme, type ThemeDefinition, type ThemeToken } from './schema';

export const THEME_STORAGE_KEY = 'moos.theme.v1';
const VARIABLES: Record<ThemeToken, string> = { accent: '--moos-accent', accentSoft: '--moos-accent-soft', border: '--moos-border', panel: '--moos-panel', sidebar: '--moos-sidebar', muted: '--moos-muted', radius: '--moos-radius', rightPanelWidth: '--moos-right-panel-width' };
const SELECTORS = { sidebar: '.workspace-sidebar', conversation: '.conversation-pane', composer: '.composer-dock', rightPanel: '.right-panel' } as const;
export function resetTheme() {
  for (const variable of Object.values(VARIABLES)) document.documentElement.style.removeProperty(variable);
  document.getElementById('moos-theme-regions')?.remove(); localStorage.removeItem(THEME_STORAGE_KEY);
}
export function applyTheme(input: unknown, { persist = false }: { persist?: boolean } = {}) {
  const theme = validateTheme(input); resetTheme();
  for (const [key, value] of Object.entries(theme.tokens)) document.documentElement.style.setProperty(VARIABLES[key as ThemeToken], value);
  const rules = Object.entries(theme.styles).map(([region, style]) => {
    const declarations = Object.entries(style ?? {}).map(([property, value]) => property === 'backgroundAsset'
      ? `background-image:url("${theme.assets[value]}")` : `${property.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}:${value}`);
    return `${SELECTORS[region as keyof typeof SELECTORS]}{${declarations.join(';')}}`;
  });
  if (rules.length) { const element = document.createElement('style'); element.id = 'moos-theme-regions'; element.textContent = rules.join('\n'); document.head.append(element); }
  if (persist) localStorage.setItem(THEME_STORAGE_KEY, theme.id);
  return theme;
}
export function loadSavedTheme(catalog: unknown[]) {
  const saved = localStorage.getItem(THEME_STORAGE_KEY); if (!saved) { resetTheme(); return 'default'; }
  const candidate = catalog.find(item => item && typeof item === 'object' && (item as { id?: string }).id === saved);
  try { if (!candidate) throw new Error('Theme missing'); applyTheme(candidate, { persist: true }); return saved; }
  catch { resetTheme(); return 'default'; }
}
