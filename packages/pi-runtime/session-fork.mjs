import { chmod, lstat, mkdtemp, rename, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';

async function forkSource({ origin, dataDir, cwd, staging }) {
  if (!origin || !/^[a-zA-Z0-9_-]{1,100}$/.test(origin.conversationId)
    || !/^[a-zA-Z0-9_-]+\.jsonl$/.test(origin.file) || !/^[a-zA-Z0-9_-]{1,160}$/.test(origin.leaf)) return;
  const source = join(dataDir, origin.conversationId);
  const file = join(source, origin.file);
  try {
    if (!(await lstat(source)).isDirectory() || !(await lstat(file)).isFile()) return;
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  const manager = SessionManager.open(file, staging, cwd);
  const entry = manager.getEntry(origin.leaf);
  if (manager.getHeader()?.cwd !== cwd || entry?.type !== 'message' || entry.message.role !== 'assistant'
    || entry.message.stopReason !== 'stop') return;
  return manager.createBranchedSession(origin.leaf);
}

function seedText(manager, history, model) {
  for (const { role, text, timestamp } of history) {
    const message = { role, content: [{ type: 'text', text }], timestamp };
    manager.appendMessage(role === 'user' ? message : { ...message, api: model.api,
      provider: model.provider, model: model.id, stopReason: 'stop',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  }
}

export async function openPiSession({ cwd, root, dataDir, fork, model }) {
  const current = SessionManager.continueRecent(cwd, root);
  if (!fork || current.getLeafId() !== null) return current;
  const staging = await mkdtemp(join(root, '.fork-'));
  try {
    let file = await forkSource({ origin: fork.origin, dataDir, cwd, staging });
    if (!file) {
      if (!fork.history.some(item => item.role === 'assistant')) {
        seedText(current, fork.history, model);
        return current;
      }
      const history = SessionManager.create(cwd, staging);
      seedText(history, fork.history, model);
      file = history.getSessionFile();
    }
    const destination = join(root, basename(file));
    await chmod(file, 0o600);
    await rename(file, destination);
    return SessionManager.open(destination, root, cwd);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
