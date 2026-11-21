import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { prepareStartupClips, startupClipArguments } from './desktop-startup-clips.mjs';

async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), 'moos-startup-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('startup clip arguments keep other build options and reject an absent or repeated directory', () => {
  assert.deepEqual(startupClipArguments(['--trim-maps']), { remaining: ['--trim-maps'] });
  assert.deepEqual(startupClipArguments(['--trim-maps', '--splash-root', '/local clips', '--strip-node']),
    { root: '/local clips', remaining: ['--trim-maps', '--strip-node'] });
  assert.throws(() => startupClipArguments(['--splash-root', '--trim-maps']), /one splash/);
  assert.throws(() => startupClipArguments(['--splash-root', 'one', '--splash-root', 'two']), /one splash/);
});

test('ordinary builds generate the default startup presentation without importing MP4 files', async t => {
  const ui = await temporaryDirectory(t);
  assert.equal(await prepareStartupClips(ui), 0);
  assert.equal(await readFile(join(ui, 'startup-clips.ts'), 'utf8'), 'export const startupClips: readonly string[] = [];\n');
});

test('local clips get fixed asset names and non-regular files are ignored', async t => {
  const ui = await temporaryDirectory(t);
  const clips = await temporaryDirectory(t);
  await writeFile(join(clips, 'b".MP4'), 'second');
  await writeFile(join(clips, 'a.mp4'), 'first');
  await writeFile(join(clips, 'info.txt'), 'ignored');
  await symlink('a.mp4', join(clips, 'copy.mp4'));
  assert.equal(await prepareStartupClips(ui, clips), 2);
  assert.equal(await readFile(join(ui, 'assets/startup/clip-0.mp4'), 'utf8'), 'first');
  assert.equal(await readFile(join(ui, 'assets/startup/clip-1.mp4'), 'utf8'), 'second');
  assert.match(await readFile(join(ui, 'startup-clips.ts'), 'utf8'), /\[clip0, clip1\]/);
});

test('invalid clip collections and files are rejected', async t => {
  const ui = await temporaryDirectory(t);
  const clips = await temporaryDirectory(t);
  await assert.rejects(prepareStartupClips(ui, clips), /1–8/);
  const clip = join(clips, 'first.mp4');
  await writeFile(clip, '');
  await assert.rejects(prepareStartupClips(ui, clips), /size/);
  await truncate(clip, 20 * 1024 * 1024 + 1);
  await assert.rejects(prepareStartupClips(ui, clips), /size/);
  await symlink(clips, join(ui, 'alias'));
  await assert.rejects(prepareStartupClips(ui, join(ui, 'alias')), /directory/);
});
