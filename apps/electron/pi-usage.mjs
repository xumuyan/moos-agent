import { DatabaseSync } from 'node:sqlite';

// The scheduler already persists one usage event for each PI response. Read
// those events directly so existing sessions count and restarts cannot add
// duplicate usage rows.
export function createPiUsageReader(dbPath) {
  let db;
  let summary;
  let session;
  function open() {
    if (db) return;
    const connection = new DatabaseSync(dbPath, { readOnly: true });
    try {
      summary = connection.prepare(`
        SELECT count(*) AS requests,
          sum(json_extract(payload, '$.totalTokens')) AS totalTokens,
          sum(json_extract(payload, '$.inputTokens')) AS inputTokens,
          sum(json_extract(payload, '$.outputTokens')) AS outputTokens,
          CASE WHEN count(json_extract(payload, '$.cacheReadTokens')) = count(*)
            THEN sum(json_extract(payload, '$.cacheReadTokens')) END AS cacheReadTokens,
          CASE WHEN count(json_extract(payload, '$.cacheWriteTokens')) = count(*)
            THEN sum(json_extract(payload, '$.cacheWriteTokens')) END AS cacheWriteTokens
        FROM events WHERE type = 'usage'
      `);
      session = connection.prepare(`
        SELECT json_extract(payload, '$.totalTokens') - json_extract(payload, '$.outputTokens') AS promptTokens,
          json_extract(payload, '$.contextWindow') AS contextWindow,
          json_extract(payload, '$.cacheReadTokens') AS cacheReadTokens
        FROM events
        WHERE type = 'usage' AND conversationId = (SELECT value FROM settings WHERE key = ?)
        ORDER BY id DESC LIMIT 1
      `);
      db = connection;
    } catch (error) {
      connection.close();
      throw error;
    }
  }

  return {
    read(sessionId) {
      if (sessionId !== null && (typeof sessionId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(sessionId))) {
        throw new Error('Invalid Moos usage session');
      }
      open();
      if (sessionId === null) return { ...summary.get() };
      const latest = session.get('dsh-session:' + sessionId);
      if (!latest) return null;
      const { promptTokens, contextWindow, cacheReadTokens } = latest;
      return { promptTokens, contextWindow, cacheHitRate: promptTokens > 0 &&
        cacheReadTokens !== null && cacheReadTokens <= promptTokens ? cacheReadTokens / promptTokens : null };
    },
    close() {
      db?.close();
      db = undefined;
    },
  };
}
