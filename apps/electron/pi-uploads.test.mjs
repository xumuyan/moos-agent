import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { saveWorkspaceUpload } from './plugin/host.js';

test('workspace uploads land in cwd/.moos-uploads with a digest prefix and safe names', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'moos-uploads-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const bytes = new Uint8Array([0, 1, 2, 3, 255]);
  const path = await saveWorkspaceUpload(bytes, 'pack.zip', cwd, mkdir, writeFile);
  assert.equal(path, '.moos-uploads/ff5d8507-pack.zip');
  const saved = await readFile(join(cwd, path));
  assert.deepEqual([...saved], [0, 1, 2, 3, 255]);
  const listing = await readdir(join(cwd, '.moos-uploads'));
  assert.deepEqual(listing, ['ff5d8507-pack.zip']);
  // 名称中的路径分隔符、控制字符与首部点被替换，避免逃出上传目录。
  const hostile = await saveWorkspaceUpload(new Uint8Array([1]), '../..\\bad\x00name.log', cwd, mkdir, writeFile);
  assert.equal(hostile, '.moos-uploads/4bf5122f-__.._bad_name.log');
  const listing2 = await readdir(join(cwd, '.moos-uploads'));
  assert.ok(listing2.includes('4bf5122f-__.._bad_name.log'));
  assert.ok(!listing2.some(entry => entry.includes('/')));
  const blank = await saveWorkspaceUpload(new Uint8Array([1]), '', cwd, mkdir, writeFile);
  assert.match(blank, /-file$/);
  await assert.rejects(saveWorkspaceUpload(new Uint8Array([1]), 'x.log', 'relative/cwd', mkdir, writeFile),
    /workspace directory/);
});
