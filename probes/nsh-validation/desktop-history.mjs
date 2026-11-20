import { DatabaseSync } from 'node:sqlite';

// The boundary is captured before admitting any request. Only previous-process
// messages are read here; live rows (including tools) remain in the controller.
export function openDesktopHistory(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const upper = db.prepare('SELECT COALESCE(max(rowid), 0) AS upper FROM messages').get().upper;
    const cursor = db.prepare(`SELECT rowid AS position FROM messages WHERE id = ? AND conversationId = ?
      AND rowid <= ? AND role IN ('user', 'assistant')`);
    const page = db.prepare(`SELECT id, role, substr(content, 1, 4097) AS text FROM messages
      WHERE conversationId = ? AND rowid <= ? AND rowid < ? AND role IN ('user', 'assistant')
      ORDER BY rowid DESC LIMIT 13`);
    return {
      close: () => db.close(),
      read({ projectId, sessionId, before }) {
        const position = before === null ? upper + 1 : cursor.get(before, sessionId, upper)?.position;
        if (position === undefined) return null;
        const rows = page.all(sessionId, upper, position);
        const messages = rows.slice(0, 12).reverse().map(({ id, role, text }) => {
          const characters = [...text];
          return { id, role, text: characters.slice(0, 4096).join(''), truncated: characters.length > 4096 };
        });
        return { projectId, sessionId, messages, before: rows.length > 12 ? messages[0].id : null };
      },
    };
  } catch (error) { db.close(); throw error; }
}
