// Offline import CLI. The source is accessed only with read operations.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, closeSync, copyFileSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const uuid = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function regular(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Unexpected source file type');
  return stat;
}
function files(root, suffix) {
  const result = [];
  for (const item of readdirSync(root, { withFileTypes: true })) {
    const file = join(root, item.name);
    if (item.isDirectory()) result.push(...files(file, suffix));
    if (item.isFile() && item.name.endsWith(suffix)) result.push(file);
  }
  return result;
}

const iso = value => {
  const date = new Date(typeof value === 'number' || typeof value === 'string' ? value : 0);
  return Number.isNaN(date.valueOf()) ? new Date(0).toISOString() : date.toISOString();
};
const asText = value => typeof value === 'string' ? value : '';
const timestampState = path => {
  try {
    const info = regular(path);
    return [info.ino, info.size, info.mtimeMs, info.ctimeMs].join(':');
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};
function decode(path) {
  return path.endsWith('.zstd') ? execFileSync('/opt/homebrew/bin/zstd', ['-dqc', '--', path],
    { encoding: 'utf8', maxBuffer: 80 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }) : readFileSync(path, 'utf8');
}

export function importDesktopChat({ source, profile }) {
  profile = realpathSync(profile);
  source = realpathSync(source);
  if (profile === source || profile.startsWith(source + '/') || source.startsWith(profile + '/')) throw Error('Import requires isolated destination');
  const target = join(profile, 'imported-chat');
  const stage = join(profile, 'import-stage');
  const info = lstatSync(profile);
  if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o700) throw Error('Destination must be private');
  const lock = join(profile, '.n01-active');
  const fd = openSync(lock, 'wx', 0o600);
  let backup, db, madeStage = false;
  try {
    mkdirSync(stage, { mode: 0o700 });
    madeStage = true;
    const dsh = join(source, 'dsh');
    const pi = join(source, 'pi', 'moos.sqlite');
    const archives = [...files(join(dsh, 'sessions'), '.jsonl.zstd'), ...files(join(dsh, 'sessions'), '.jsonl')].sort();
    const metadataFiles = files(join(dsh, 'storages'), '.json').sort();
    const watched = [...archives, ...metadataFiles, pi, pi + '-wal'];
    const initial = watched.map(timestampState);
    copyFileSync(pi, join(stage, 'pi-snapshot.sqlite'));
    if (initial.at(-1) !== null) copyFileSync(pi + '-wal', join(stage, 'pi-snapshot.sqlite-wal'));
    backup = new DatabaseSync(join(stage, 'pi-snapshot.sqlite'), { readOnly: true });
    if (backup.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw Error('PI snapshot check failed');
    db = new DatabaseSync(join(stage, 'history.sqlite'));
    chmodSync(join(stage, 'history.sqlite'), 0o600);
    db.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE archive_sessions(id TEXT PRIMARY KEY, origin TEXT NOT NULL, title TEXT NOT NULL, workspace TEXT NOT NULL,
        updated TEXT NOT NULL, archived INTEGER NOT NULL, linked TEXT, inherited INTEGER NOT NULL);
      CREATE TABLE archive_messages(id INTEGER PRIMARY KEY, sessionId TEXT NOT NULL REFERENCES archive_sessions(id),
        role TEXT NOT NULL, date TEXT NOT NULL, body TEXT NOT NULL, continuation INTEGER NOT NULL);
      CREATE INDEX archive_messages_session ON archive_messages(sessionId, id);
      CREATE TABLE archive_assets(id INTEGER PRIMARY KEY, messageId INTEGER NOT NULL REFERENCES archive_messages(id),
        digest TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL);
      CREATE INDEX archive_assets_message ON archive_assets(messageId);
      BEGIN;
    `);
    mkdirSync(join(stage, 'assets'), { mode: 0o700 });
    const storage = metadataFiles.map(path => JSON.parse(readFileSync(path, 'utf8')));
    const workspaceData = storage.find(value => value.tables?.workspaces && value.global) ?? { tables: { workspaces: {} }, global: {} };
    const archiveSet = new Set(workspaceData.global.archivedSessionIds ?? []);
    const workspaceBySession = new Map();
    for (const workspace of Object.values(workspaceData.tables.workspaces)) {
      for (const id of workspace.sessionIds ?? []) workspaceBySession.set(id, workspace.title || basename(workspace.path ?? ''));
    }
    const piLinks = new Map(backup.prepare("SELECT substr(key,13) AS id,value FROM settings WHERE key LIKE 'dsh-session:%'").all().map(row => [row.id, row.value]));
    const dshLinks = new Map([...piLinks].map(([dshId, piId]) => [piId, dshId]));
    const sourceAssets = new Map(files(join(dsh, 'attachments'), '').filter(path => sha(basename(path))).map(path => [basename(path), path]));
    const assets = new Map();
    const addSession = db.prepare('INSERT INTO archive_sessions VALUES (?,?,?,?,?,?,?,?)');
    const addMessage = db.prepare('INSERT INTO archive_messages(sessionId,role,date,body,continuation) VALUES (?,?,?,?,?)');
    const addAsset = db.prepare('INSERT INTO archive_assets(messageId,digest,name,mime,bytes) VALUES (?,?,?,?,?)');
    const count = { dshSessions: 0, piSessions: 0, dshMessages: 0, piMessages: 0, attachments: 0, missingAttachments: 0, attachmentFiles: 0, linkedSessions: 0 };
    function writeMessage(sessionId, role, date, body, references = []) {
      // Bound each private IPC page and keep every Unicode code point.
      const sections = Array.from(body).reduce((result, char, index) => {
        if (index % 2000 === 0) result.push('');
        result[result.length - 1] += char;
        return result;
      }, []);
      if (!sections.length) sections.push('');
      for (const [index, section] of sections.entries()) {
        const { lastInsertRowid } = addMessage.run(sessionId, role, date, section, Number(index !== 0));
        if (index !== 0) continue;
        for (const ref of references) {
          const digest = asText(ref.attachmentId).replace(/^sha256:/, '');
          if (!sha(digest) || !sourceAssets.has(digest)) {
            count.missingAttachments++;
            addAsset.run(lastInsertRowid, '', asText(ref.name) || '附件', 'application/octet-stream', 0);
            continue;
          }
          if (!assets.has(digest)) {
            const path = sourceAssets.get(digest);
            const content = readFileSync(path);
            if (hash(content) !== digest) throw Error('Attachment hash differs');
            const destination = join(stage, 'assets', digest);
            copyFileSync(path, destination);
            chmodSync(destination, 0o600);
            if (hash(readFileSync(destination)) !== digest) throw Error('Copied attachment verification failed');
            assets.set(digest, content.length);
            count.attachmentFiles++;
          }
          addAsset.run(lastInsertRowid, digest, asText(ref.name) || '附件', asText(ref.mediaType) || 'application/octet-stream', assets.get(digest));
          count.attachments++;
        }
      }
    }
    const sessionIds = new Set(), dshTitles = new Map();
    for (const path of archives) {
      const [header, ...events] = decode(path).trimEnd().split('\n').filter(Boolean).map(line => JSON.parse(line));
      if (header?.type !== 'session' || !uuid(header.id) || sessionIds.has(header.id)) throw Error('Invalid or duplicate DSH session');
      sessionIds.add(header.id);
      const title = events.findLast(row => row.type === 'session/title' && typeof row.data?.title === 'string')?.data.title || '新会话';
      dshTitles.set(header.id, title);
      const linked = piLinks.get(header.id);
      if (linked) count.linkedSessions++;
      const updated = iso(events.at(-1)?.time ?? header.createdAt);
      addSession.run('dsh-' + header.id, 'DSH', title, workspaceBySession.get(header.id) || basename(asText(header.cwd)) || '默认工作区',
        updated, Number(archiveSet.has(header.id)), linked ? 'pi-' + linked : null, Number(header.isSeeded === true));
      count.dshSessions++;
      for (const row of events) {
        if (!['user/message', 'assistant/message'].includes(row.type)) continue;
        const message = row.data?.message ?? row.data;
        const parts = Array.isArray(message?.content) ? message.content : [];
        const body = Array.isArray(message?.content) ? parts.filter(p => p.type === 'text').map(p => asText(p.text)).join('\n') : asText(message?.content);
        const refs = parts.filter(p => p.attachment && ['image', 'file'].includes(p.type)).map(p => p.attachment);
        writeMessage('dsh-' + header.id, row.type.split('/')[0], iso(row.time), body, refs);
        count.dshMessages++;
      }
    }
    const piSessions = backup.prepare(`SELECT c.id,c.title,c.createdAt,p.name AS workspace,
      (SELECT max(createdAt) FROM messages WHERE conversationId=c.id) AS updated
      FROM conversations c JOIN projects p ON p.id=c.projectId ORDER BY c.rowid`).all();
    for (const row of piSessions) {
      if (!uuid(row.id)) throw Error('Invalid PI conversation');
      const id = 'pi-' + row.id, linked = dshLinks.get(row.id), match = linked && sessionIds.has(linked);
      addSession.run(id, 'PI', dshTitles.get(linked) || row.title, (match && workspaceBySession.get(linked)) || row.workspace,
        iso(row.updated ?? row.createdAt), Number(archiveSet.has(linked)), match ? 'dsh-' + linked : null, 0);
      count.piSessions++;
      const messages = backup.prepare(`SELECT m.*,s.value AS attachments FROM messages m
        LEFT JOIN settings s ON s.key='dsh-image:'||m.taskId AND m.role='user' WHERE m.conversationId=? ORDER BY m.rowid`).all(row.id);
      for (const m of messages) {
        const refs = m.attachments ? JSON.parse(m.attachments) : [];
        writeMessage(id, m.role, iso(m.createdAt), m.content, Array.isArray(refs) ? refs : [refs]);
        count.piMessages++;
      }
    }
    const latest = [...files(join(dsh, 'sessions'), '.jsonl.zstd'), ...files(join(dsh, 'sessions'), '.jsonl')].sort();
    if (archives.join('\u0000') !== latest.join('\u0000') || watched.some((path, i) => timestampState(path) !== initial[i])) throw Error('Source changed while preparing snapshot; retry');
    db.exec('COMMIT');
    if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').get()) throw Error('Imported database check failed');
    db.close(); db = null;
    backup.close(); backup = null;
    for (const suffix of ['', '-wal', '-shm']) rmSync(join(stage, 'pi-snapshot.sqlite' + suffix), { force: true });
    // Atomic installation. A previous import is never replaced implicitly.
    try { lstatSync(target); throw Error('Destination already has an imported archive'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    renameSync(stage, target);
    return count;
  } finally {
    db?.close();
    backup?.close();
    if (madeStage) rmSync(stage, { recursive: true, force: true });
    closeSync(fd); unlinkSync(lock);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw Error('Pass an isolated destination profile directory');
  process.umask(0o077);
  try {
    console.log(JSON.stringify(importDesktopChat({
      source: join(homedir(), 'Library/Application Support/dev.moos.agent.electron'),
      profile: process.argv[2],
    })));
  } catch (error) {
    // Parser or tool errors can include source text.
    const allowed = ['Import requires isolated destination', 'Destination must be private',
      'Source changed while preparing snapshot; retry', 'Destination already has an imported archive', 'Attachment hash differs'];
    console.error(allowed.includes(error.message) ? error.message : 'Unable to import isolated chat snapshot');
    process.exitCode = 1;
  }
}
