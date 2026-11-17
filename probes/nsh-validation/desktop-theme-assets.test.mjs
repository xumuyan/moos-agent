import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { artPaths, artNames, parseArtRoot, prepareArtwork } from './desktop-theme-assets.mjs';
import { characterLayout, desktopTheme, clamp, sliceAxis } from './desktop-theme.ts';
test('art CLI is explicit, rejects missing/duplicate values; default does not read HOME', () => {
  assert.equal(parseArtRoot([]), null); assert.equal(parseArtRoot(['--native', '--art-root', '/explicit']), '/explicit');
  for (const args of [['--art-root'], ['--art-root','--native'], ['--art-root','a','--art-root','b']]) assert.throws(() => parseArtRoot(args));
});
test('source mapping is complete and independent of JSON ordering', async () => {
  const facts = JSON.parse(await readFile(new URL('./skin-source.json', import.meta.url)));
  assert.deepEqual([...artPaths].sort(), facts.assets.map(a => a.path.split('/').pop()).sort());
  assert.equal(new Set(artNames).size, 17);
});
test('art loader validates all bytes and confines symlinks before writing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nsh-art-test-'));
  try {
    const root = join(dir, 'skin'), out = join(dir, 'out'); await mkdir(join(root,'assets'), { recursive:true });
    const facts = { assets: [] };
    for (const [i, filename] of artPaths.entries()) {
      const bytes = Buffer.from(`synthetic test art ${i}`);
      await writeFile(join(root, 'assets', filename), bytes);
      facts.assets.unshift({ path: `assets/${filename}`, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    await prepareArtwork(root, out, facts);
    const generated = await readFile(join(out, 'desktop-theme-art.ts'), 'utf8');
    assert.match(generated, /"icon": art0/); assert.match(generated, /maid-composer-frame-v4/);
    await rm(out, { recursive:true });
    const file = join(root,'assets',artPaths[0]); const original = await readFile(file);
    await writeFile(file, Buffer.concat([original, Buffer.from('x')]));
    await assert.rejects(prepareArtwork(root, out, facts), /size mismatch/);
    await assert.rejects(access(out));
    await writeFile(file, Buffer.alloc(original.length, 0));
    await assert.rejects(prepareArtwork(root, out, facts), /hash mismatch/);
    await rm(file); await writeFile(join(dir,'outside'), original); await symlink(join(dir,'outside'), file);
    await assert.rejects(prepareArtwork(root, out, facts), /escapes skin root/);
    await assert.rejects(access(out));
    await assert.rejects(prepareArtwork(root, out, { assets: [] }), /asset count/);
    await assert.rejects(prepareArtwork(join(dir,'missing'), out, facts), /ENOENT/);
  } finally { await rm(dir, { recursive:true, force:true }); }
});
test('source tokens, responsive character sizes and cascade retain exact facts', () => {
  assert.equal(desktopTheme.gold, '#c5a468'); assert.equal(desktopTheme.paper, '#f8fafff0');
  assert.equal(desktopTheme.dark.user, '#1e2f5af7'); assert.equal(desktopTheme.caret, '#bcd2ff');
  assert.equal(clamp(26, 24.8, 34), 26); assert.equal(clamp(26, 60, 34), 34);
  const idle = characterLayout(1240,820,280,false,false);
  assert.equal(idle.leftH, 787.1999999999999); assert.equal(idle.rightH,754.4); assert.equal(idle.left,296.12);
  const chat = characterLayout(1000,820,280,true,false);
  assert.equal(chat.left,293); assert.equal(chat.opacity,.9); // chat selector outranks <=1080 base opacity
  assert.equal(characterLayout(1000,820,280,false,false).opacity,.74);
  const narrow = characterLayout(680,720,184,true,false);
  assert.equal(narrow.left,184); assert.equal(narrow.right,0); assert.equal(narrow.leftH,331.2);
  const details = characterLayout(1240,820,280,true,true);
  assert.equal(details.right,320); assert.equal(details.rightH,459.20000000000005);
  assert.equal(characterLayout(680,720,184,true,true).rightVisible,false);
});

test('nine-slice axes preserve corners, zero cuts and shrink narrow destinations without overlap', () => {
  assert.deepEqual(sliceAxis(1800,120,120), [0,120,1680,1800]);
  assert.deepEqual(sliceAxis(588,170,115), [0,170,473,588]);
  assert.deepEqual(sliceAxis(308,0,0), [0,0,308,308]);
  assert.deepEqual(sliceAxis(60,54,54), [0,30,30,60]);
  assert.deepEqual(sliceAxis(0,54,54), [0,0,0,0]);
});
