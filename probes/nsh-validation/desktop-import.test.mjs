import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { importDesktopChat } from './desktop-import.mjs';
import { startDesktopHost } from './desktop-host.mjs';

test('isolated import preserves archived DSH text, long PI history and scoped attachment bytes without source writes', async t => {
  process.umask(0o077);
  const root = await realpath(await mkdtemp(join(tmpdir(), 'n01-import-test-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source'), profile = join(root, 'profile');
  for (const part of ['dsh/storages','dsh/sessions','dsh/attachments','pi']) await mkdir(join(source, part), { recursive: true });
  await mkdir(profile, { mode: 0o700 });
  let host = await startDesktopHost({ profileDir: profile });
  await host.close();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGNIn3qAJMQwqmFUw/DVAACx2bwQBikQCwAAAABJRU5ErkJggg==', 'base64');
  const digest = createHash('sha256').update(png).digest('hex');
  await writeFile(join(source, 'dsh/attachments', digest), png);
  const dsh = join(source, 'dsh/sessions', 'session.jsonl');
  const long = '示例🖼️'.repeat(5000);
  await writeFile(dsh, [
    { type: 'session', id: 'session-1', createdAt: 1, isSeeded: true },
    { type: 'session/title', time: 2, data: { title: '保存的会话' } },
    { type: 'user/message', time: 3, data: { content: [{ type: 'text', text: long }, { type: 'image',
      attachment: { attachmentId: 'sha256:' + digest, name: '示例.png', mediaType: 'image/png' } }] } },
    { type: 'assistant/message', time: 4, data: { message: { content: [{ type: 'text', text: '旧回复' }] } } },
  ].map(value => JSON.stringify(value)).join('\n'));
  await writeFile(join(source,'dsh/storages/global.json'), JSON.stringify({
    global: { archivedSessionIds: ['session-1'] }, tables: { workspaces: { folder: { title: '旧工作区', sessionIds: ['session-1'] } } },
  }));
  const pi = join(source,'pi/moos.sqlite');
  const db = new DatabaseSync(pi);
  db.exec(`CREATE TABLE settings(key TEXT,value TEXT); CREATE TABLE projects(id TEXT,name TEXT);
    CREATE TABLE conversations(id TEXT, title TEXT, projectId TEXT, createdAt TEXT);
    CREATE TABLE messages(id TEXT, conversationId TEXT, taskId TEXT, role TEXT, content TEXT, createdAt TEXT);
    INSERT INTO settings VALUES('dsh-session:session-1','pi-conversation');
    INSERT INTO projects VALUES('p','旧工作区');
    INSERT INTO conversations VALUES('pi-conversation','原会话','p','2026-01-02T00:00:00Z');
    INSERT INTO messages VALUES('one','pi-conversation',NULL,'assistant','PI 文本','2026-01-02T00:00:00Z');
    INSERT INTO messages VALUES('two','pi-conversation','task-1','user','PI 附件','2026-01-02T00:00:01Z');`);
  db.prepare('INSERT INTO settings VALUES (?,?)').run('dsh-image:task-1', JSON.stringify({
    attachmentId: 'sha256:' + digest, mediaType: 'image/png',
  }));
  db.close();
  const sourceDigest = async () => createHash('sha256').update(await readFile(dsh)).update(await readFile(pi)).digest('hex');
  const before = await sourceDigest();
  const receipt = importDesktopChat({ source, profile });
  assert.deepEqual(receipt, { dshSessions: 1, piSessions: 1, dshMessages: 2, piMessages: 2, attachments: 2, missingAttachments: 0, attachmentFiles: 1, linkedSessions: 1 });
  assert.equal(await sourceDigest(), before);
  assert.equal((await lstat(join(profile, 'imported-chat/history.sqlite'))).mode & 0o777, 0o600);
  assert.throws(() => importDesktopChat({ source, profile }), /already has/);
  host = await startDesktopHost({ profileDir: profile });
  try {
    assert.throws(() => importDesktopChat({ source, profile }), { code: 'EEXIST' });
    const call = (action, params = {}) => host.call({ version: 1, id: 'test', method: 'sessions.manage', params: { action, ...params } });
    const rows = call('importedList').result.imported;
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].title, rows[0].workspace, rows[0].archived, rows[0].messages], ['保存的会话','旧工作区',1,2]);
    const items = [], sessionId = rows[0].id;
    let before = null;
    do {
      const result = call('importedPage', { sessionId, before }).result.importedPage;
      items.unshift(...result.items);
      before = result.before;
    } while (before);
    assert.equal(items.filter(r => r.role==='user').map(r => r.body).join(''), long);
    const assetId = items[0].assets[0].id;
    assert.deepEqual(Buffer.from(call('importedAsset', { sessionId, assetId, offset: 0, reveal: false }).result.asset.data, 'base64'), png);
    assert.equal(call('importedAsset', { sessionId: rows[0].linked, assetId, offset: 0, reveal: false }).error.code, 'not_found');
    assert.equal(call('importedPage', { sessionId: rows[0].linked, before: null }).result.importedPage.items[0].body, 'PI 文本');
  } finally { await host.close(); }
});
