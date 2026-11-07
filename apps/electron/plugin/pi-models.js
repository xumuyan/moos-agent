import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const levels = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);
const services = new Set(['openai', 'glm', 'deepseek']);

async function json(path, missing) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.size > 262144) throw new Error('Invalid Moos model configuration file');
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return missing;
    throw error;
  }
}

export function piModels(data, checkedProvider) {
  const privateRoot = join(data, 'private');
  const profilePath = join(data, 'providers.json');
  const credentialPath = join(privateRoot, 'credentials.json');
  let writes = Promise.resolve();

  function validate(row) {
    if (!row || typeof row !== 'object') throw new Error('Invalid Moos model profile');
    const provider = {
      id: row.id, model: row.model, api: row.api, baseUrl: row.baseUrl, name: row.name ?? row.model,
      contextWindow: row.contextWindow ?? 128000, maxTokens: row.maxTokens ?? 8192,
      thinkingLevel: row.thinkingLevel ?? 'off', service: row.service ?? 'openai',
      ...(row.imageInput === true ? { imageInput: true } : {}),
    };
    if (!levels.has(provider.thinkingLevel) || !services.has(provider.service) ||
        provider.id === 'auto' || provider.id === 'pi-fixture' ||
        provider.service !== 'openai' && provider.api !== 'openai-completions') {
      throw new Error('Invalid Moos model profile');
    }
    provider.baseUrl = checkedProvider(provider);
    return provider;
  }

  async function list() {
    const rows = await json(profilePath, []);
    if (!Array.isArray(rows) || rows.length > 32) throw new Error('Invalid Moos model profiles');
    const profiles = new Map();
    for (const row of rows) {
      const provider = validate(row);
      if (profiles.has(provider.id)) throw new Error('Duplicate Moos model profile');
      profiles.set(provider.id, provider);
    }
    return [...profiles.values()];
  }

  function select(profiles, id) {
    return id === 'auto'
      ? profiles.find(profile => profile.service === 'glm') ?? profiles[0]
      : profiles.find(profile => profile.id === id);
  }

  async function resolve(id) { return select(await list(), id); }

  async function plan(id, image = false) {
    const profiles = (await list()).filter(profile => !image || profile.imageInput);
    const provider = select(profiles, id);
    if (!provider || id !== 'auto') return { provider };
    const alternatives = profiles.filter(item => item.id !== provider.id &&
      (item.baseUrl !== provider.baseUrl || item.model !== provider.model));
    const strong = alternatives.find(item => item.service === 'openai' && item.thinkingLevel === 'xhigh')
      ?? alternatives.find(item => item.service === 'openai' && item.thinkingLevel === 'high');
    const backup = strong ?? alternatives[0];
    return { provider, backup: backup && { provider: backup, repair: Boolean(strong) &&
      (provider.thinkingLevel !== 'xhigh' && (provider.thinkingLevel !== 'high' || strong.thinkingLevel === 'xhigh')) } };
  }

  async function credentials() {
    const info = await lstat(credentialPath).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (!info) return {};
    const directory = await lstat(privateRoot);
    if (!directory.isDirectory() || directory.mode & 0o077 || !info.isFile() || info.mode & 0o077) {
      throw new Error('Invalid Moos credential permissions');
    }
    return json(credentialPath, {});
  }

  function validKey(key) {
    return typeof key === 'string' && key.length > 0 && key.length <= 16384 && !/[\x00\r\n]/.test(key);
  }

  async function credential(provider) {
    const keys = await credentials();
    const entry = Object.hasOwn(keys, provider.id) && keys[provider.id];
    if (entry?.baseUrl !== provider.baseUrl || !validKey(entry.apiKey)) {
      throw new Error('Missing Moos model credential for this service address');
    }
    return entry.apiKey;
  }

  async function replace(path, value) {
    const temporary = path + '.' + randomUUID();
    try {
      await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      await rename(temporary, path);
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }

  function save(input) {
    const pending = writes.then(async () => {
      const provider = validate(input);
      const profiles = await list();
      const index = profiles.findIndex(item => item.id === provider.id);
      if (index === -1 && profiles.length >= 32) throw new Error('Too many Moos model profiles');
      await mkdir(privateRoot, { recursive: true, mode: 0o700 });
      if (!(await lstat(privateRoot)).isDirectory()) throw new Error('Invalid Moos credential directory');
      await chmod(privateRoot, 0o700);
      const keys = await credentials();
      const previous = Object.hasOwn(keys, provider.id) && keys[provider.id];
      const key = input.apiKey === '' || input.apiKey === undefined
        ? (previous?.baseUrl === provider.baseUrl && previous.apiKey) : input.apiKey;
      if (!validKey(key)) throw new Error('Missing or invalid Moos API key');
      if (index < 0) profiles.push(provider);
      else profiles[index] = provider;
      await replace(credentialPath, { ...keys, [provider.id]: { baseUrl: provider.baseUrl, apiKey: key } });
      await replace(profilePath, profiles);
      return profiles;
    });
    writes = pending.catch(() => {});
    return pending;
  }

  return { list, resolve, plan, credential, save };
}
