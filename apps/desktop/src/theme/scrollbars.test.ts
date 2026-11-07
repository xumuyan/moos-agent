import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const css = readFileSync('src/theme/dsh/tokens.css', 'utf8');
const scrollbars = css.slice(css.indexOf('@supports not selector(::-webkit-scrollbar)'));

it('reserves scrollbar geometry and reveals paint for hover and keyboard focus', () => {
  expect(scrollbars).toContain('scrollbar-color: transparent transparent');
  expect(scrollbars).toContain('*:hover::-webkit-scrollbar-thumb');
  expect(scrollbars).toContain('*:focus-within::-webkit-scrollbar-thumb');
  expect(scrollbars).toContain('body *:focus-within');
  expect(scrollbars).toContain('width: var(--moos-scrollbar-width)');
  expect(scrollbars).toContain('height: var(--moos-scrollbar-width)');
  expect(scrollbars).toMatch(/::-webkit-scrollbar-thumb\s*\{[^}]*background: transparent/s);
  expect(scrollbars).not.toMatch(/display:\s*none|overflow:\s*hidden|scrollbar-width:\s*none/);
});

it('keeps standard properties inside their exclusive fallback and touch thumbs visible', () => {
  const webkitPath = scrollbars.slice(scrollbars.indexOf('\n::-webkit-scrollbar {'));
  expect(webkitPath).not.toMatch(/scrollbar-(?:width|color)\s*:/);
  expect(scrollbars).toContain('(hover: none), (forced-colors: active)');
  expect(scrollbars).toContain('scrollbar-color: auto');
  expect(webkitPath).toMatch(/@media \(hover: none\)\s*\{\s*::-webkit-scrollbar-thumb\s*\{\s*background-color: var\(--moos-scrollbar-thumb\)/);
  expect(webkitPath).toMatch(/@media \(forced-colors: active\)\s*\{\s*::-webkit-scrollbar-thumb\s*\{\s*background-color: GrayText/);
  expect(webkitPath).toContain('background-color: var(--moos-scrollbar-thumb-hover)');
});
