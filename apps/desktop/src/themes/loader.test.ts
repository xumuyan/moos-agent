import { expect, it } from 'vitest';
import { applyTheme, loadSavedTheme, THEME_STORAGE_KEY } from './loader';

const ocean = { id: 'ocean', name: 'Ocean', version: '1.0.0', moosVersion: '^0.1.0',
  tokens: { accent: '#116b68', panel: '#f7fbfb' }, styles: { sidebar: { backgroundColor: '#e7f2f1' } }, assets: {} };

it('previews without persistence and persists only an explicit valid apply', () => {
  applyTheme(ocean, { persist: false });
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  applyTheme(ocean, { persist: true });
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('ocean');
  expect(document.documentElement.style.getPropertyValue('--moos-accent')).toBe('#116b68');
});

it('falls back to default and clears incompatible or missing saved themes', () => {
  localStorage.setItem(THEME_STORAGE_KEY, 'removed-theme');
  expect(loadSavedTheme([ocean])).toBe('default');
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  localStorage.setItem(THEME_STORAGE_KEY, 'ocean');
  expect(loadSavedTheme([{ ...ocean, moosVersion: '^0.2.0' }])).toBe('default');
  expect(document.documentElement.style.getPropertyValue('--moos-accent')).toBe('');
});
