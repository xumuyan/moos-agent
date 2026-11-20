// Trusted desktop launch only. Nothing in here is writable through the bridge.
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkedProvider } from '../../packages/pi-adapter/index.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
export const configParts = Object.freeze(['artifacts', 'nsh-validation', 'private-models']);
const groups = Object.freeze({ 'glm-coding': 'GLM Coding Plan', 'openai-relay': 'OpenAI 兼容中转' });
const ids = Object.keys(groups);
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const invalid = () => new Error('Invalid isolated desktop model configuration');

// Pure validation; the HTTP exception is only used by local integration tests.
export function liveModelRoutes(settings, credentials, { testLoopback = false } = {}) {
  if (!exact(settings, ids) || !exact(credentials, ids)) throw invalid();
  const routes = new Map(), options = [];
  for (const id of ids) {
    const profile = settings[id], apiKey = credentials[id];
    if (!exact(profile, ['baseUrl', 'api', 'model', 'contextWindow', 'maxTokens']) ||
        typeof apiKey !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(apiKey)) throw invalid();
    const provider = { ...profile, id, name: groups[id], ...(id === 'glm-coding' && { service: 'glm' }) };
    const url = new URL(checkedProvider(provider));
    if (provider.model.length > 80) throw invalid();
    if ((url.protocol !== 'https:' && !testLoopback) || /\/(?:chat\/completions|responses)$/i.test(url.pathname)) throw invalid();
    const reasoning = id === 'glm-coding' && provider.api === 'openai-responses' ? {
      defaultId: 'low', levels: [{ id: 'off', label: '关闭' }, { id: 'low', label: '低' },
        { id: 'high', label: '高' }, { id: 'max', label: '最高' }],
    } : undefined;
    routes.set(id, { provider, apiKey });
    options.push({ id, label: provider.model, group: { id, label: groups[id] }, ...(reasoning && { reasoning }) });
  }
  return { routes, catalog: { options, defaultId: ids[0] } };
}

async function readPrivateJson(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.uid !== process.getuid() || info.nlink !== 1 || (info.mode & 0o7777) !== 0o600) throw invalid();
    const buffer = Buffer.alloc(16 * 1024 + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset === buffer.length) throw invalid();
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, offset)));
  } finally { await handle.close(); }
}

// The candidate reads only repo/artifacts/nsh-validation/private-models.
// Injecting a root is for isolated test setup; no argv/env/RPC path override.
export async function loadLiveModels(repoRoot = repo) {
  try {
    let dir = await realpath(repoRoot);
    for (const part of configParts) {
      dir = join(dir, part);
      const info = await lstat(dir);
      if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o022)) throw invalid();
      if (part === 'private-models' && (info.mode & 0o7777) !== 0o700) throw invalid();
    }
    return liveModelRoutes(await readPrivateJson(join(dir, 'providers.json')), await readPrivateJson(join(dir, 'credentials.json')));
  } catch { throw invalid(); } // No pathname, JSON parser excerpt, endpoint or credential on startup failure.
}
