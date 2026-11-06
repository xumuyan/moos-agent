import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('preserves scrolling and fixed scrollbar dimensions while hiding only the paint', () => {
  const css = readFileSync('src/theme/scrollbars.css', 'utf8');
  expect(css).toContain('scrollbar-color: transparent transparent');
  expect(css).toContain('*:hover::-webkit-scrollbar-thumb');
  expect(css).toContain('*:focus-visible');
  expect(css).toContain('(hover: none), (forced-colors: active)');
  expect(css).not.toMatch(/display:\s*none|overflow:\s*hidden|scrollbar-width:\s*none/);
  expect(css.match(/width: 8px/g)).toHaveLength(1);
});
