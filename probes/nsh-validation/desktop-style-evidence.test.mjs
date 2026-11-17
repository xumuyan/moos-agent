import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
test('style evidence runner only copies required native theme modules, never adopts integration entry', () => {
  const runner = read('./verify-desktop-theme.mjs');
  for (const module of ['desktop-theme.ts', 'desktop-theme-layers.tsx', 'desktop-theme-art.ts', 'assets/desktop']) assert.ok(runner.includes(module));
  assert.ok(!runner.includes("'DesktopView.tsx', 'DesktopApp.tsx'"));
  assert.ok(runner.includes('generatedEntry: true'));
  assert.ok(runner.includes("child.stderr ?? ''"));
  assert.ok(!runner.includes('verify-desktop-ui.mjs'));
});
test('style evidence capture fixes content, appearance and scale and reports actual outer frame', () => {
  const capture = read('./desktop-style-capture.tsx');
  for (const token of ['scaleFactor).toBe(1)', 'STYLE_FRAME ', 'contentBounds', '680, 720', '1240, 820', "locale: 'zh-CN'", 'reducedMotion: true', '【合成样式证据】', 'dark-details', 'narrow-sidebar']) assert.ok(capture.includes(token), token);
});
test('portable PNG evidence parser and crop constraints reject false source/geometry', () => {
  const result = spawnSync('python3', [fileURLToPath(new URL('./desktop_style_evidence_test.py', import.meta.url))], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, timeout: 20000 });
  assert.equal(result.status, 0, result.stderr + result.stdout);
});
