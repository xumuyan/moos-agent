import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { modelSettingsThemeCss, readWorkbenchTheme } from './model-settings-theme.mjs';

test('the isolated form receives only resolved palette colors and the color scheme', () => {
  let removed = false;
  const probe = { style: {}, remove() { removed = true; } };
  const context = {
    clearRect() {},
    fillRect() {},
    getImageData() {
      const pixels = {
        CanvasText: [255, 255, 255, 255],
        'var(--dsw-alias-bg-overlay, transparent)': [20, 34, 66, 240],
        'var(--dsw-alias-state-business-primary, transparent)': [152, 173, 225, 255],
      };
      return { data: pixels[this.fillStyle] ?? [0, 0, 0, 0] };
    },
  };
  const theme = runInNewContext(readWorkbenchTheme, {
    document: {
      createElement: tag => tag === 'span' ? probe : { getContext: () => context },
      body: { append: node => assert.equal(node, probe) },
    },
    getComputedStyle: node => node.style,
  });
  assert.ok(removed);
  assert.equal(modelSettingsThemeCss(theme),
    'html:root{color-scheme:dark;--model-surface:#142242f0;--model-accent:#98ade1ff}');
  assert.equal(modelSettingsThemeCss({
    scheme: 'dark;}body{display:none',
    surface: 'url(https://example.com)',
    field: '#00000000;display:none',
    text: '#FAFAFAFF',
    unknown: '#112233ff',
  }), 'html:root{--model-text:#FAFAFAFF}');
  assert.equal(modelSettingsThemeCss(null), 'html:root{}');
});
