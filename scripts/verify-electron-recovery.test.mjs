import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const script = fileURLToPath(new URL('./verify-electron-recovery.mjs', import.meta.url));

test('GUI recovery verification requires explicit isolated build and output arguments', async () => {
  await assert.rejects(run(process.execPath, [script]), error => {
    assert.match(error.stderr, /Usage:/);
    return true;
  });
});

test('GUI recovery verification rejects the formal installed app before copying or launching it', async () => {
  await assert.rejects(run(process.execPath, [script, '/Applications/Moos.app', '/must-not-write']), error => {
    assert.match(error.stderr, /Only repository-isolated build paths/);
    return true;
  });
});

for (const installedName of ['Moos', 'MuMa', '沐码']) {
  test(`brand acceptance refuses installed ${installedName} before copying or launching it`, async () => {
    const brandScript = fileURLToPath(new URL('./verify-electron-brand.mjs', import.meta.url));
    await assert.rejects(run(process.execPath, [brandScript, `/Applications/${installedName}.app`, '/must-not-write']), error => {
      assert.match(error.stderr, /Only repository-isolated build paths/);
      return true;
    });
  });
}
