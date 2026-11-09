import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// GLM 旧档位（minimal/medium/xhigh）仅兼容读取；界面只提供官方 low/high/max。
const levels = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const services = new Set(['openai', 'glm', 'deepseek']);
const configId = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const maxConfigBytes = 262144;

async function json(path, missing) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.size > maxConfigBytes) throw new Error('Invalid Moos model configuration file');
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
  const imageGenPath = join(privateRoot, 'image-gen-settings.json');
  const imageGenKeyId = 'image-gen-key';
  const imageDefaultModel = 'gpt-image-2.5-flare';
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
        provider.service === 'deepseek' && provider.api !== 'openai-completions') {
      throw new Error('Invalid Moos model profile');
    }
    provider.baseUrl = checkedProvider(provider);
    if (row.connectionId !== undefined) {
      if (typeof row.connectionId !== 'string' || !configId.test(row.connectionId) ||
          typeof row.credentialId !== 'string' || !configId.test(row.credentialId) ||
          typeof row.connectionName !== 'string' || !row.connectionName.trim() ||
          row.connectionName.length > 200 || /[\x00-\x1f\x7f]/.test(row.connectionName)) {
        throw new Error('Invalid Moos model connection');
      }
      Object.assign(provider, { connectionId: row.connectionId, connectionName: row.connectionName, credentialId: row.credentialId });
    }
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
    const id = provider.credentialId ?? provider.id;
    const entry = Object.hasOwn(keys, id) && keys[id];
    if (entry?.baseUrl !== provider.baseUrl || !validKey(entry.apiKey)) {
      throw new Error('Missing Moos model credential for this service address');
    }
    return entry.apiKey;
  }

  async function testConnection(input, diagnoseProvider) {
    let provider;
    try {
      provider = validate({ ...input, id: input?.id || 'diagnostic', name: input?.name || input?.model });
    } catch {
      return diagnoseProvider('test_provider');
    }
    const apiKey = input.apiKey === '' || input.apiKey === undefined
      ? await credential(provider).catch(() => undefined) : input.apiKey;
    return diagnoseProvider('test_provider', { provider, apiKey });
  }

  // 图片服务（云桥 OpenAI Images 兼容）：元数据存 private/image-gen-settings.json，密钥与模型密钥同文件同级保护。
  async function imageGen() {
    const rows = await json(imageGenPath, null);
    if (!rows || rows.enabled === false) return null;
    if (typeof rows.baseUrl !== 'string' || !/^https?:\/\//.test(rows.baseUrl) ||
        typeof rows.model !== 'string' || !rows.model.trim() || rows.model.length > 200 || /[\x00-\x1f\x7f]/.test(rows.model) ||
        typeof rows.credentialId !== 'string' || !configId.test(rows.credentialId)) return null;
    const keys = await credentials().catch(() => ({}));
    const entry = Object.hasOwn(keys, rows.credentialId) && keys[rows.credentialId];
    if (!entry || entry.baseUrl !== rows.baseUrl || !validKey(entry.apiKey)) return null;
    return { baseUrl: rows.baseUrl, model: rows.model, apiKey: entry.apiKey };
  }

  async function imageStatus() {
    const rows = await json(imageGenPath, null);
    const keys = await credentials().catch(() => ({}));
    if (!rows || typeof rows !== 'object') return { enabled: false, baseUrl: '', model: imageDefaultModel, keyConfigured: false };
    const keyId = typeof rows.credentialId === 'string' && configId.test(rows.credentialId) ? rows.credentialId : '';
    const entry = keyId && Object.hasOwn(keys, keyId) && keys[keyId];
    return {
      enabled: rows.enabled !== false,
      baseUrl: typeof rows.baseUrl === 'string' ? rows.baseUrl : '',
      model: typeof rows.model === 'string' && rows.model.trim() ? rows.model : imageDefaultModel,
      ...(keyId ? { credentialId: keyId } : {}),
      keyConfigured: Boolean(entry && entry.apiKey),
    };
  }

  function saveImageGen(input) {
    return serialize(async () => {
      if (!input || typeof input !== 'object') throw new Error('Invalid Moos image settings');
      if (input.enabled === false) {
        // 禁用时保留其余字段，重新启用时可直接恢复地址与模型。
        const previous = await json(imageGenPath, null);
        await replace(imageGenPath, { ...(previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {}),
          enabled: false });
        return imageStatus();
      }
      let baseUrl = typeof input.baseUrl === 'string' ? input.baseUrl.trim() : '';
      if (!/^https?:\/\//.test(baseUrl)) throw new Error('Invalid Moos image base URL');
      while (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
      const model = typeof input.model === 'string' && input.model.trim() ? input.model.trim() : imageDefaultModel;
      if (model.length > 200 || /[\x00-\x1f\x7f]/.test(model)) throw new Error('Invalid Moos image model');
      const previous = await json(imageGenPath, null);
      const keys = await prepareCredentials();
      const previousKey = previous && typeof previous.credentialId === 'string' &&
        Object.hasOwn(keys, previous.credentialId) ? keys[previous.credentialId] : undefined;
      const key = input.apiKey === '' || input.apiKey === undefined
        ? (previousKey?.baseUrl === baseUrl && previousKey.apiKey) : input.apiKey;
      if (!validKey(key)) throw new Error('Missing or invalid Moos image API key');
      const credentialId = previousKey?.baseUrl === baseUrl && previous && typeof previous.credentialId === 'string'
        ? previous.credentialId : imageGenKeyId;
      await replace(credentialPath, { ...keys, [credentialId]: { baseUrl, apiKey: key } });
      await replace(imageGenPath, { enabled: true, baseUrl, model, credentialId });
      return imageStatus();
    });
  }

  async function testImageGen(input) {
    const started = performance.now();
    const finish = (ok, status, message) => ({ ok,
      ...(status === undefined ? {} : { status }), message, elapsedMs: Math.round(performance.now() - started) });
    let baseUrl = typeof input?.baseUrl === 'string' ? input.baseUrl.trim() : '';
    if (!/^https?:\/\//.test(baseUrl)) return finish(false, undefined, '请先填写 http(s) 服务地址');
    while (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
    let apiKey = input?.apiKey;
    if (apiKey === '' || apiKey === undefined) {
      const rows = await json(imageGenPath, null);
      const keys = await credentials().catch(() => ({}));
      const entry = rows && typeof rows.credentialId === 'string' && configId.test(rows.credentialId) && keys[rows.credentialId];
      apiKey = entry?.baseUrl === baseUrl ? entry.apiKey : undefined;
    }
    if (typeof apiKey !== 'string' || !validKey(apiKey)) return finish(false, undefined, '请先填写密钥');
    // GET /models 仅验证认证与连通，不发起付费生成请求。
    try {
      const response = await fetch(`${baseUrl}/models`, {
        headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
        signal: AbortSignal.timeout(15000), redirect: 'manual',
      });
      if (response.status === 200) return finish(true, 200, '图片服务验证成功 · 密钥有效（未发起付费请求）');
      const bodyText = await response.text().catch(() => '');
      if (response.status === 401 || response.status === 403) {
        return finish(false, response.status, '认证失败 · 请检查密钥及其分组（gpt-image-2.5 需绑定图片专用分组）');
      }
      return finish(false, response.status, `服务返回 HTTP ${response.status}${bodyText ? ' · ' + bodyText.slice(0, 160) : ''}`);
    } catch (error) {
      return finish(false, undefined, `无法连接图片服务 · ${error?.cause?.code ?? error?.name ?? '网络错误'}`);
    }
  }

  async function replace(path, value) {
    const content = JSON.stringify(value, null, 2) + '\n';
    if (Buffer.byteLength(content) > maxConfigBytes) throw new Error('Moos model configuration is too large');
    const temporary = path + '.' + randomUUID();
    try {
      await writeFile(temporary, content, { mode: 0o600, flag: 'wx' });
      await rename(temporary, path);
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }

  function serialize(write) {
    const pending = writes.then(write);
    writes = pending.catch(() => {});
    return pending;
  }

  async function prepareCredentials() {
    await mkdir(privateRoot, { recursive: true, mode: 0o700 });
    if (!(await lstat(privateRoot)).isDirectory()) throw new Error('Invalid Moos credential directory');
    await chmod(privateRoot, 0o700);
    return credentials();
  }

  function connectionId(provider) { return provider.connectionId ?? provider.id; }

  function groupProfiles(profiles, keys) {
    const groups = new Map();
    for (const provider of profiles) {
      const id = connectionId(provider);
      if (!groups.has(id)) {
        const keyId = provider.credentialId ?? provider.id;
        const key = Object.hasOwn(keys, keyId) && keys[keyId];
        groups.set(id, { id, name: provider.connectionName ?? provider.name,
          baseUrl: provider.baseUrl, api: provider.api, service: provider.service,
          keyConfigured: key?.baseUrl === provider.baseUrl && validKey(key.apiKey), models: [] });
      }
      groups.get(id).models.push({ profileId: provider.id, id: provider.model, name: provider.name,
        thinkingLevel: provider.thinkingLevel, contextWindow: provider.contextWindow, maxTokens: provider.maxTokens,
        ...(provider.imageInput ? { input: ['text', 'image'] } : {}) });
    }
    return [...groups.values()];
  }

  async function groups() {
    return groupProfiles(await list(), await credentials());
  }

  function connectionModel(input, row, id, connection) {
    const model = row?.id?.trim();
    const contextWindow = row?.contextWindow ?? 128000;
    return validate({ ...connection, id, model, name: row?.name?.trim() || model,
      baseUrl: input.baseUrl, api: input.api, service: input.service,
      contextWindow, maxTokens: row?.maxTokens ?? Math.min(8192, contextWindow),
      thinkingLevel: row?.thinkingLevel, imageInput: Array.isArray(row?.input) && row.input.includes('image') });
  }

  function saveGroup(input) {
    return serialize(async () => {
      if (!Array.isArray(input?.models) || !input.models.length || input.models.length > 32) {
        throw new Error('A Moos connection needs 1 to 32 models');
      }
      const profiles = await list();
      const existing = profiles.filter(provider => connectionId(provider) === input.id);
      if (input.id && !existing.length) throw new Error('Moos connection no longer exists');
      const id = input.id || input.route || randomUUID();
      if (!input.id && input.route !== undefined &&
          (typeof input.route !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id) ||
          !configId.test(id) || id === 'auto' || id === 'pi-fixture' ||
          profiles.some(provider => connectionId(provider) === id))) {
        throw new Error('Invalid or duplicate Moos connection ID');
      }
      const first = existing[0];
      const connectionName = input.name?.trim();
      const connection = { connectionId: id, connectionName, credentialId: first?.credentialId ?? first?.id ?? id };
      const allowedIds = new Set(existing.map(provider => provider.id));
      let replacements = input.models.map(row => {
        if (row?.profileId && !allowedIds.has(row.profileId)) throw new Error('Invalid Moos connection model');
        const previous = existing.find(provider => provider.id === row?.profileId);
        const sameEndpoint = previous && previous.baseUrl === new URL(input.baseUrl).href.replace(/\/$/, '')
          && previous.api === input.api && previous.service === (input.service ?? 'openai')
          && previous.model === row?.id?.trim();
        const preserved = row?.input === undefined && sameEndpoint && previous.imageInput
          ? { ...row, input: ['text', 'image'] } : row;
        return connectionModel(input, preserved, row?.profileId || randomUUID(), connection);
      });
      if (new Set(replacements.map(provider => provider.model)).size !== replacements.length ||
          new Set(replacements.map(provider => provider.id)).size !== replacements.length) {
        throw new Error('Duplicate Moos connection model');
      }
      if (profiles.length - existing.length + replacements.length > 32) throw new Error('Too many Moos model profiles');
      const baseUrl = replacements[0].baseUrl;
      if (input.apiKey === '' || input.apiKey === undefined) {
        if (!first || first.baseUrl !== baseUrl) throw new Error('Missing Moos API key for this service address');
        await credential(first);
      } else {
        if (!validKey(input.apiKey)) throw new Error('Invalid Moos API key');
        const keys = await prepareCredentials();
        const inUse = new Set(profiles.map(provider => provider.credentialId ?? provider.id));
        // Keep credentials used by the current file until the new configuration is committed.
        const retained = Object.fromEntries(Object.entries(keys).filter(([key]) => !key.startsWith('group-key-') || inUse.has(key)));
        const credentialId = 'group-key-' + randomUUID();
        await replace(credentialPath, { ...retained, [credentialId]: { baseUrl, apiKey: input.apiKey } });
        replacements = replacements.map(provider => ({ ...provider, credentialId }));
      }
      const insertion = first ? profiles.indexOf(first) : profiles.length;
      const next = [...profiles.slice(0, insertion), ...replacements,
        ...profiles.slice(insertion).filter(provider => !allowedIds.has(provider.id))];
      await replace(profilePath, next);
      return groups();
    });
  }

  function removeGroup(id) {
    return serialize(async () => {
      if (typeof id !== 'string' || !configId.test(id)) throw new Error('Invalid Moos connection');
      const profiles = await list();
      const removed = profiles.filter(provider => connectionId(provider) === id);
      if (!removed.length) return;
      const kept = profiles.filter(provider => connectionId(provider) !== id);
      const inUse = new Set(kept.map(provider => provider.credentialId ?? provider.id));
      const keys = await credentials();
      const removing = new Set(removed.flatMap(provider => [provider.id, provider.credentialId]));
      const retained = Object.entries(keys).filter(([key]) =>
        inUse.has(key) || !removing.has(key) && !key.startsWith('group-key-'));
      if (retained.length !== Object.keys(keys).length) await replace(credentialPath, Object.fromEntries(retained));
      await replace(profilePath, kept);
    });
  }

  async function diagnoseGroup(method, input, diagnoseProvider) {
    let provider;
    try {
      const model = method === 'list_models' ? { id: 'discovery' } : input.model;
      provider = connectionModel(input, model, 'diagnostic');
    } catch { return diagnoseProvider(method); }
    const first = (await list()).find(item => connectionId(item) === input.id);
    const apiKey = input.apiKey || (first?.baseUrl === provider.baseUrl
      ? await credential(first).catch(() => undefined) : undefined);
    return diagnoseProvider(method, { provider, apiKey });
  }

  function save(input) {
    return serialize(async () => {
      const provider = validate(input);
      const profiles = await list();
      const index = profiles.findIndex(item => item.id === provider.id);
      if (index === -1 && profiles.length >= 32) throw new Error('Too many Moos model profiles');
      if (provider.connectionId || profiles[index]?.connectionId) throw new Error('Use Moos connection settings');
      const keys = await prepareCredentials();
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
  }

  return { list, resolve, plan, credential, save, testConnection, groups, saveGroup, removeGroup, diagnoseGroup,
    imageGen, imageStatus, saveImageGen, testImageGen };
}
