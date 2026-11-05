import type { ThemeDefinition } from './schema';

export const BUILTIN_THEMES: ThemeDefinition[] = [
  { id: 'ocean', name: '浅海', version: '1.0.0', moosVersion: '^0.1.0', tokens: {
    accent: '#116b68', accentSoft: '#dcefed', border: '#cbdedc', panel: '#f7fbfb', sidebar: '#e7f2f1', muted: '#657f7d', radius: '12px', rightPanelWidth: '248px',
  }, styles: { composer: { backgroundColor: '#f7fbfb' }, rightPanel: { backgroundColor: '#f1f8f7' } }, assets: {} },
  { id: 'graphite', name: '石墨', version: '1.0.0', moosVersion: '^0.1.0', tokens: {
    accent: '#526170', accentSoft: '#e3e7ea', border: '#d2d8dd', panel: '#f8f9fa', sidebar: '#eceff1', muted: '#6e7881', radius: '7px', rightPanelWidth: '248px',
  }, styles: { sidebar: { backgroundColor: '#eceff1' }, composer: { backgroundColor: '#f8f9fa' } }, assets: {} },
];
