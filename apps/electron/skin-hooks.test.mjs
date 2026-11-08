import assert from 'node:assert/strict';
import { appendFile, cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const pluginRoot = process.env.MOOS_ELECTRON_TEST_SKIN_CENTER;
const reviewedSkin = process.env.MOOS_ELECTRON_TEST_REVIEWED_MAID;

test('the updated skin center accepts the matching Maid Atelier release and rejects changed hooks', {
  skip: !(pluginRoot && reviewedSkin) && 'Requires skin center 0.4.16 and its reviewed Maid Atelier files',
}, async t => {
  const userDir = await mkdtemp(join(tmpdir(), 'moos-reviewed-skin-'));
  t.after(() => rm(userDir, { recursive: true, force: true }));
  const dir = join(userDir, 'maid-atelier');
  await cp(reviewedSkin, dir, { recursive: true });
  const { canServeSkinHooks, loadSkinCatalog } = await import(
    pathToFileURL(join(pluginRoot, 'lib', 'index.js')).href);
  const entry = loadSkinCatalog({ userDir, builtinDir: join(userDir, 'empty') })
    .skins.find(skin => skin.manifest.id === 'maid-atelier');
  assert.ok(entry);
  assert.equal(entry.origin, 'user');
  assert.equal(canServeSkinHooks(entry), true);

  await appendFile(join(dir, 'hooks.mjs'), '\n// modified test fixture\n');
  assert.equal(canServeSkinHooks(entry), false);
});
