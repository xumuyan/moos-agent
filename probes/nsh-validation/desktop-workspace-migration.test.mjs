import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { migrateDesktopWorkspaces, pruneEmptyDesktopConversations } from './desktop-workspace-migration.mjs';
import { startDesktopHost } from './desktop-host.mjs';

test('formal workspace order, live and archived conversations, text, attachments and PI files become native session data', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'moos-workspace-migration-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'formal'), profile = join(root, 'new-profile');
  const a = join(root, 'a'), b = join(root, 'b');
  for (const path of [a, b, profile, join(source,'dsh/storages'), join(source,'dsh/sessions'),
    join(source,'dsh/attachments'), join(source,'pi/sessions/linked')]) await mkdir(path, { recursive: true, mode: 0o700 });
  const registry = { global: { workspaceIds: ['B', 'A'], defaultWorkspaceId: 'B',
      archivedSessionIds: ['archived', 'archived-draft'], pinnedSessionIds: ['native'] },
    tables: { workspaces: {
      A: { path: a, title: '甲项目', sessionIds: ['second', 'draft', 'named-empty'], createdAt: 1 },
      B: { path: b, title: '乙项目', sessionIds: ['native'], createdAt: 2 },
    } } };
  await writeFile(join(source,'dsh/storages/workspace.json'), JSON.stringify(registry));
  const file = Buffer.from('example fixture');
  const digest = createHash('sha256').update(file).digest('hex');
  await writeFile(join(source,'dsh/attachments',digest), file);
  const long = '连续消息🧩'.repeat(600);
  for (const [id, cwd, body] of [['native', b, long], ['second', a, '第二项目消息'],
    ['archived', b, '归档消息'], ['empty', root, ''],
    ['draft', a, ''], ['archived-draft', b, ''], ['named-empty', a, '']]) {
    const events = [{ type: 'session', id, cwd, createdAt: 3 }, { type: 'session/title', time: 4, data: { title: id.endsWith('draft') ? '新会话' : id } }];
    if (body) events.push({ type: 'user/message', time: 5, data: { content: [{ type: 'text', text: body },
      ...(id === 'native' ? [{ type: 'image', attachment: { attachmentId: digest, name: 'sample.png', mediaType: 'image/png' } }] : [])] } });
    await writeFile(join(source,'dsh/sessions',id + '.jsonl'), events.map(event => JSON.stringify(event)).join('\n'));
  }
  const piPath = join(source, 'pi/moos.sqlite');
  const sql = new DatabaseSync(piPath);
  sql.exec(`CREATE TABLE settings(key TEXT,value TEXT); CREATE TABLE projects(id TEXT,name TEXT);
    CREATE TABLE conversations(id TEXT,title TEXT,projectId TEXT,createdAt TEXT);
    CREATE TABLE messages(id TEXT,conversationId TEXT,taskId TEXT,role TEXT,content TEXT,createdAt TEXT);
    INSERT INTO settings VALUES ('dsh-session:native','linked');
    INSERT INTO projects VALUES ('p','乙项目');
    INSERT INTO conversations VALUES ('linked','内核会话','p','2026-01-01T00:00:00Z');`);
  sql.close();
  const piFile = '2026-01-01T00-00-00-000Z_node.jsonl';
  const pi = JSON.stringify({ type: 'session', id: 'entry', version: 3, timestamp: '2026-01-01T00:00:00Z', cwd: b }) + '\n';
  await writeFile(join(source,'pi/sessions/linked',piFile), pi);
  const dbBefore = await readFile(piPath);
  const result = await migrateDesktopWorkspaces({ source, profile });
  assert.deepEqual([result.projects,result.active,result.archived,result.piFiles,result.unattachedEmptySeeds,result.emptyDrafts], [2,3,1,1,1,2]);
  assert.deepEqual(await readFile(piPath), dbBefore);
  assert.equal(await readFile(join(profile,'data/native',piFile),'utf8'), pi);
  await assert.rejects(migrateDesktopWorkspaces({ source, profile }), /empty isolated destination/);

  const recovered = new DatabaseSync(join(profile,'data/desktop.sqlite'));
  const create = recovered.prepare("INSERT INTO conversations VALUES (?, 'B', '新会话 2', '2026-01-01T00:00:00Z')");
  for (const id of ['local-draft','local-archived-draft','pinned-draft','task-draft','message-draft','pi-draft']) create.run(id);
  recovered.exec(`INSERT INTO settings VALUES ('desktop.session.local-archived-draft','{"archived":true}');
    INSERT INTO settings VALUES ('desktop.session.pinned-draft','{"pinned":true}');
    INSERT INTO tasks(id,projectId,conversationId,message,status,createdAt,updatedAt)
      VALUES ('task','B','task-draft','test','cancelled','2026-01-01','2026-01-01');
    INSERT INTO messages VALUES ('attachment-message','message-draft',NULL,'user','','2026-01-01');`);
  recovered.close();
  await mkdir(join(profile,'data/pi-draft'), { mode: 0o700 });
  assert.deepEqual(await pruneEmptyDesktopConversations(profile), { active: 1, archived: 1 });
  assert.deepEqual(await pruneEmptyDesktopConversations(profile), { active: 0, archived: 0 });
  assert.deepEqual(await readFile(piPath), dbBefore);

  for (let restart = 0; restart < 2; restart++) {
    const host = await startDesktopHost({ profileDir: profile });
    try {
      const call = (method, params = {}) => host.call({ version: 1, id: 'test', method, params });
      const ok = (method, params) => { const response = call(method, params); assert.ok(response.ok, response.error?.code); return response.result; };
      const catalog = ok('projects.list');
      assert.deepEqual(catalog.projects, [{ id: 'B', name: '乙项目' }, { id: 'A', name: '甲项目' }]);
      assert.equal(catalog.workspaceMigration, true);
      assert.equal(catalog.models.defaultId, 'configure-model');
      assert.equal(ok('sessions.list', { projectId: 'B' }).imported, undefined);
      assert.deepEqual(ok('sessions.list', { projectId: 'A' }).sessions.map(s => s.id), ['second','named-empty']);
      assert.deepEqual(ok('sessions.list', { projectId: 'B' }).sessions.map(s => [s.id,s.pinned ?? false]),
        [['native',true], ['pinned-draft',true], ['task-draft',false], ['message-draft',false], ['pi-draft',false]]);
      assert.deepEqual(ok('sessions.manage', { projectId: 'B', action: 'listArchived' }).sessions.map(s => s.id), ['archived']);
      const scope = { projectId: 'B', sessionId: 'native' };
      const page = ok('sessions.history', { ...scope, before: null });
      assert.equal(page.messages.map(row => row.text).join(''), long);
      const asset = page.messages[0].assets[0];
      const request = { ...scope, action: 'importedAsset', assetId: asset.id, offset: 0, reveal: false };
      assert.deepEqual(Buffer.from(ok('sessions.manage', request).asset.data, 'base64'), file);
      assert.equal(call('sessions.manage', { ...request, projectId: 'A' }).error.code, 'not_found');
      assert.equal(call('tasks.submit', { ...scope, requestId: 'fixture-blocked', text: '未配置模型' }).error.code, 'invalid_request');
    } finally { await host.close(); }
  }
});
