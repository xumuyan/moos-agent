import { DatabaseSync } from 'node:sqlite';
import { constants, closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { verifyProfileEntry } from './desktop-profile.mjs';

export async function openImportedHistory(profile) {
  const root = join(profile, 'imported-chat');
  try { await verifyProfileEntry(root, true); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const path = join(root, 'history.sqlite');
  await verifyProfileEntry(path, false);
  await verifyProfileEntry(join(root, 'assets'), true);
  const db = new DatabaseSync(path, { readOnly: true });
  db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF');
  return {
    close: () => db.close(),
    list() {
      return db.prepare(`SELECT a.id,a.origin,a.title,a.workspace,a.updated,a.archived,a.linked,
        (SELECT count(*) FROM archive_messages WHERE sessionId=a.id AND continuation=0) AS messages
        FROM archive_sessions a WHERE a.origin='DSH' OR a.linked IS NULL ORDER BY a.updated DESC`).all();
    },
    page(sessionId, before) {
      const session = db.prepare('SELECT * FROM archive_sessions WHERE id=?').get(sessionId);
      if (!session || (before !== null && !db.prepare('SELECT 1 FROM archive_messages WHERE id=? AND sessionId=?').get(before, sessionId))) return;
      const rows = db.prepare(`SELECT id,role,date,body,continuation FROM archive_messages WHERE sessionId=? AND id<?
        ORDER BY id DESC LIMIT 13`).all(sessionId, before ?? Number.MAX_SAFE_INTEGER);
      const items = rows.slice(0, 12).reverse().map(row => ({
        ...row,
        assets: db.prepare('SELECT id,name,mime,bytes FROM archive_assets WHERE messageId=? ORDER BY id').all(row.id),
      }));
      return { session, items, before: rows.length > 12 ? items[0].id : null };
    },
    asset(sessionId, assetId, offset, reveal) {
      const row = db.prepare(`SELECT a.digest,a.mime,a.bytes FROM archive_assets a JOIN archive_messages m ON a.messageId=m.id
        WHERE a.id=? AND m.sessionId=?`).get(assetId, sessionId);
      if (!row || !/^[a-f0-9]{64}$/.test(row.digest)) return;
      const path = join(root, 'assets', row.digest);
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const status = fstatSync(fd);
        if (!status.isFile() || status.uid !== process.getuid() || status.nlink !== 1 ||
            (status.mode & 0o777) !== 0o600 || status.size !== row.bytes) return;
        if (reveal) {
          const child = spawn('/usr/bin/open', ['-R', path], { stdio: 'ignore' });
          child.on('error', () => {});
          child.unref();
          return {};
        }
        if (!['image/png','image/jpeg','image/jpg','image/gif','image/webp'].includes(row.mime) || offset >= row.bytes) return;
        const buffer = Buffer.alloc(Math.min(row.bytes - offset, 98304));
        const read = readSync(fd, buffer, 0, buffer.length, offset);
        return { data: buffer.subarray(0, read).toString('base64'), end: offset + read >= row.bytes };
      } finally { closeSync(fd); }
    },
  };
}
