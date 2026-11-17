import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Only synthetic/offline fixtures. Does not call the collector on the user home.
test('N01-D3 skin provenance fixtures, licensing and precise style facts remain valid', () => {
  const result = spawnSync('python3', [fileURLToPath(new URL('./skin_source_test.py', import.meta.url))], {
    encoding: 'utf8', timeout: 20_000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stderr, /Ran 11 tests/);
});
