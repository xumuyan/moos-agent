// Build a new native profile from a consistent, read-only formal chat snapshot.
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { Store } from '../../services/agent/store.mjs';
import { importDesktopChat } from './desktop-import.mjs';
import { leaseDesktopProfile } from './desktop-profile.mjs';

const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(id);
const clean = (value, limit) => typeof value === 'string' && value.trim() && value.length <= limit && !/[\x00-\x1f\x7f]/.test(value);
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const migrationKey = 'desktop.workspaceMigration';

function originalPath(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || Buffer.byteLength(path) > 4096) throw Error('Invalid workspace path');
  try { return realpathSync(path); }
  catch (error) { if (error.code === 'ENOENT') return path; throw error; }
}

function snapshotPi({ source, backup, watch }, session, destination, projectPath) {
  const saved = backup.prepare('SELECT value FROM settings WHERE key=?').get('dsh-session:' + session)?.value ?? session;
  if (!validId(saved)) throw Error('Invalid linked conversation');
  const piDirectory = join(source, 'pi/sessions', saved);
  watch(piDirectory, true);
  let entries;
  try {
    if (!lstatSync(piDirectory).isDirectory()) throw Error('Invalid PI directory');
    entries = readdirSync(piDirectory, { withFileTypes: true });
  } catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
  const files = entries.filter(entry => entry.isFile() && /^[\w.:-]+\.jsonl$/.test(entry.name));
  if (!files.length) return 0;
  mkdirSync(destination, { mode: 0o700 });
  for (const { name } of files) {
    const original = join(piDirectory, name), copy = join(destination, name);
    watch(original);
    copyFileSync(original, copy);
    chmodSync(copy, 0o600);
    if (hash(original) !== hash(copy)) throw Error('PI session verification failed');
    const firstLine = readFileSync(copy, 'utf8').split('\n', 1)[0];
    const header = JSON.parse(firstLine);
    if (header.type !== 'session' || originalPath(header.cwd) !== projectPath) throw Error('PI session workspace differs');
  }
  return files.length;
}

export async function migrateDesktopWorkspaces({ source, profile }) {
  const lease = await leaseDesktopProfile(profile);
  try {
    if (!lease.fresh) throw Error('Use an empty isolated destination');
    await lease.ready();
  } finally { await lease.close(); }
  const data = join(profile, 'data');
  mkdirSync(data, { mode: 0o700 });
  const dbPath = join(data, 'desktop.sqlite');
  writeFileSync(dbPath, '', { flag: 'wx', mode: 0o600 });
  new Store({ dbPath }).close();

  let summary;
  const copied = importDesktopChat({ source, profile, materialize: snapshot => {
    const { workspaceData, history, backup, sourceSessions } = snapshot;
    const { workspaceIds, archivedSessionIds = [], pinnedSessionIds = [] } = workspaceData.global;
    if (!Array.isArray(workspaceIds) || !workspaceIds.length || workspaceIds.length > 8 ||
        !Array.isArray(archivedSessionIds) || !Array.isArray(pinnedSessionIds)) throw Error('Invalid workspace registry');
    const workspaces = workspaceData.tables.workspaces;
    if (workspaceIds.length !== Object.keys(workspaces).length || new Set(workspaceIds).size !== workspaceIds.length) throw Error('Incomplete workspace order');
    const sourceById = new Map(sourceSessions.map(session => [session.id, session]));
    const assigned = new Set(), projects = new Map();
    const archive = new Set(archivedSessionIds), pinned = new Set(pinnedSessionIds);
    const record = history.prepare('SELECT id,role,date,body FROM archive_messages WHERE sessionId=? ORDER BY id');
    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA foreign_keys=ON; BEGIN');
    const projectRow = db.prepare('INSERT INTO projects VALUES (?,?,?,?)');
    const sessionRow = db.prepare('INSERT INTO conversations VALUES (?,?,?,?)');
    const messageRow = db.prepare('INSERT INTO messages VALUES (?, ?, NULL, ?, ?, ?)');
    const setting = db.prepare('INSERT INTO settings VALUES (?, ?)');
    const iso = date => new Date(date ?? 0).toISOString();
    let active = 0, archived = 0, piFiles = 0, unattachedEmptySeeds = 0, messageChunks = 0;
    function addSession(session, project) {
      if (!validId(session.id) || !clean(session.title, 100) || assigned.has(session.id)) throw Error('Invalid or repeated conversation in workspace');
      const archivedSession = archive.has(session.id);
      assigned.add(session.id);
      sessionRow.run(session.id, project.id, session.title, iso(session.createdAt));
      const state = { archiveId: 'dsh-' + session.id, archived: archivedSession, pinned: pinned.has(session.id) };
      const rows = record.all(state.archiveId);
      for (const row of rows) {
        messageRow.run('source-' + row.id, session.id, row.role, row.body, row.date);
      }
      messageChunks += rows.length;
      const versions = snapshotPi(snapshot, session.id, join(data, session.id), project.path);
      piFiles += versions;
      if (!versions && rows.length) state.fork = true;
      setting.run('desktop.session.' + session.id, JSON.stringify(state));
      if (archivedSession) archived++; else active++;
    }
    try {
      for (const id of workspaceIds) {
        const workspace = workspaces[id];
        if (!validId(id) || !workspace || !Array.isArray(workspace.sessionIds) ||
            workspace.sessionIds.filter(session => !archive.has(session)).length > 16 ||
            !clean(workspace.title, 100)) throw Error('Invalid workspace record');
        const path = originalPath(workspace.path);
        const project = { id, path };
        projectRow.run(id, workspace.title, path, iso(workspace.createdAt));
        projects.set(id, project);
        for (const sid of workspace.sessionIds) {
          const session = sourceById.get(sid);
          if (!session) throw Error('Project references missing conversation');
          addSession(session, project);
        }
      }
      const fallback = projects.get(workspaceData.global.defaultWorkspaceId) ?? projects.values().next().value;
      for (const session of sourceSessions) {
        if (assigned.has(session.id)) continue;
        const cwd = session.cwd ? originalPath(session.cwd) : null;
        const project = [...projects.values()].find(p => p.path === cwd);
        if (archive.has(session.id)) addSession(session, project ?? fallback);
        else if (project && record.get('dsh-' + session.id)) addSession(session, project);
        else if (!record.get('dsh-' + session.id)) unattachedEmptySeeds++;
        else throw Error('Unassigned conversation requires a workspace');
      }
      for (const { id } of backup.prepare("SELECT id FROM conversations WHERE id NOT IN (SELECT value FROM settings WHERE key LIKE 'dsh-session:%')").all()) {
        if (record.get('pi-' + id)) throw Error('Full migration requires a source session for each PI conversation');
      }
      setting.run(migrationKey, '1');
      if (db.prepare('PRAGMA foreign_key_check').get()) throw Error('Native workspace integrity check failed');
      db.exec('COMMIT');
      summary = { projects: projects.size, active, archived, piFiles, messageChunks, unattachedEmptySeeds };
    } finally { db.close(); }
  } });
  return { ...copied, ...summary };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw Error('Pass an empty private candidate directory');
  process.umask(0o077);
  try {
    console.log(JSON.stringify(await migrateDesktopWorkspaces({
      source: join(homedir(), 'Library/Application Support/dev.moos.agent.electron'), profile: process.argv[2],
    })));
  } catch (error) {
    // Database and parser errors may contain private paths or chat text.
    const reasons = ['Use an empty isolated destination','Invalid workspace path','Invalid linked conversation',
      'Invalid PI directory','PI session verification failed','PI session workspace differs',
      'Invalid workspace registry','Incomplete workspace order','Invalid or repeated conversation in workspace',
      'Invalid workspace record','Project references missing conversation','Unassigned conversation requires a workspace',
      'Full migration requires a source session for each PI conversation','Native workspace integrity check failed',
      'Source changed while preparing snapshot; retry'];
    console.error(reasons.includes(error.message) ? error.message : 'Unable to prepare candidate workspace migration');
    process.exitCode = 1;
  }
}
