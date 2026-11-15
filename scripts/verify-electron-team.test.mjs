import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';

test('team renderer acceptance refuses production bundle before creating or launching QA copy', async () => {
  await assert.rejects(promisify(execFile)(process.execPath, ['scripts/verify-electron-team.mjs', '/Applications/沐码.app'], {
    timeout: 10000, env: { ...process.env, NODE_OPTIONS: '' },
  }), error => error.code === 1 && /AssertionError/.test(error.stderr));
  const source = await readFile(new URL('./verify-electron-team.mjs', import.meta.url), 'utf8');
  assert.ok(source.indexOf('assert.ok(resolve(inputApp)') < source.indexOf('const scratch ='));
  for (const condition of ['realpath(inputApp)', 'normalGUI: false', 'externalModel: false',
    'modeClearDoesNotCancel', 'independentReadAndArtifact', 'ordinaryAfterClear']) assert.ok(source.includes(condition));
});
