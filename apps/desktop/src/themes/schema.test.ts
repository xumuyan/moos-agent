import { expect, it } from 'vitest';
import { validateTheme } from './schema';

const valid = { id: 'ocean', name: 'Ocean', version: '1.0.0', moosVersion: '^0.1.0',
  tokens: { accent: '#116b68', panel: '#f7fbfb' }, styles: { sidebar: { backgroundColor: '#e7f2f1' } }, assets: {} };

it('accepts whitelisted theme tokens, fixed regions and static assets', () => {
  expect(validateTheme(valid).tokens.accent).toBe('#116b68');
  expect(validateTheme({ ...valid, assets: { grain: 'data:image/png;base64,AA==' }, styles: { composer: { backgroundAsset: 'grain' } } }).id).toBe('ocean');
});

it('rejects scripts, remote imports, global selectors, unknown tokens and incompatible versions', () => {
  expect(() => validateTheme({ ...valid, tokens: { evil: '#fff' } })).toThrow(/token/i);
  expect(() => validateTheme({ ...valid, styles: { body: { color: '#fff' } } })).toThrow(/region/i);
  expect(() => validateTheme({ ...valid, assets: { x: 'https://evil.test/x.png' } })).toThrow(/asset/i);
  expect(() => validateTheme({ ...valid, styles: { sidebar: { backgroundColor: 'url(javascript:alert(1))' } } })).toThrow(/style/i);
  expect(() => validateTheme({ ...valid, moosVersion: '^0.2.0' })).toThrow(/compatible/i);
});
