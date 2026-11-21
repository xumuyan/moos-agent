import { closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { checkedProvider } from '../../packages/pi-adapter/index.mjs';

export const desktopEfforts = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const effortNames = ['关闭', 'Minimal', 'Low', 'Medium', 'High', 'Extra High', '最高'];
const protocols = ['openai-completions', 'openai-responses'];
const validText = (value, max) => typeof value === 'string' && !!value.trim() &&
  value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const validId = value => typeof value === 'string' && /^[a-z0-9-]{1,64}$/.test(value);
const limit = 256 * 1024;

function checkedModel(group, input, id) {
  if (!input || !validText(input.label, 80) || !validText(input.model, 200) ||
      typeof input.imageInput !== 'boolean' || !Array.isArray(input.efforts) || !input.efforts.length ||
      new Set(input.efforts).size !== input.efforts.length ||
      !input.efforts.every(e => desktopEfforts.includes(e)) || !input.efforts.includes(input.defaultEffort) ||
      (group.service === 'glm' && (group.api !== 'openai-responses'
        ? input.efforts.some(e => e !== 'off')
        : input.efforts.some(e => !['off', 'low', 'high', 'max'].includes(e))))) throw Error('invalid_request');
  checkedProvider({ ...input, ...group, ...{ id, name: input.label, model: input.model } });
  return { id, label: input.label.trim(), model: input.model, contextWindow: input.contextWindow,
    maxTokens: input.maxTokens, imageInput: input.imageInput, efforts: [...input.efforts], defaultEffort: input.defaultEffort };
}

function checkedGroup(input, groupId, key) {
  if (!validText(input?.name, 80) || !validText(input.baseUrl, 2048) || !protocols.includes(input.api) ||
      !['openai', 'glm'].includes(input.service) || typeof key !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(key)) {
    throw Error('invalid_request');
  }
  const url = new URL(input.baseUrl);
  if (url.protocol !== 'https:' || /\/(?:chat\/completions|responses)\/?$/i.test(url.pathname)) throw Error('invalid_request');
  return { id: groupId, name: input.name.trim(), baseUrl: url.href.replace(/\/$/, ''), api: input.api, service: input.service, apiKey: key };
}

export function desktopModelServices(root, fixtureOptions) {
  const folder = join(root, 'private');
  const file = join(folder, 'credentials.json');
  try { mkdirSync(folder, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const folderInfo = lstatSync(folder);
  if (!folderInfo.isDirectory() || folderInfo.uid !== process.getuid() || (folderInfo.mode & 0o777) !== 0o700) {
    throw Error('Unsafe model service directory');
  }
  let groups = [];
  try {
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = fstatSync(fd);
      if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid() ||
          (info.mode & 0o777) !== 0o600 || info.size > limit) throw Error('Unsafe model service file');
      const data = JSON.parse(readFileSync(fd, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.groups) || data.groups.length > 8) throw Error('Invalid model services');
      const ids = new Set();
      groups = data.groups.map(input => {
        const unique = id => {
          if (!validId(id) || ids.has(id)) throw Error('Invalid model service id');
          ids.add(id);
          return id;
        };
        const group = checkedGroup(input, unique(input.id), input.apiKey);
        if (!Array.isArray(input.models) || input.models.length < 1 || input.models.length > 7) throw Error('Invalid service models');
        return { ...group, models: input.models.map(m => checkedModel(group, m, unique(m.id))) };
      });
    } finally { closeSync(fd); }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }

  function persisted(next) {
    const value = JSON.stringify({ version: 1, groups: next });
    if (Buffer.byteLength(value) > limit) throw Error('limit');
    const stage = join(folder, randomUUID());
    try {
      const fd = openSync(stage, 'wx', 0o600);
      try { writeFileSync(fd, value); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(stage, file);
      groups = next;
    } finally { rmSync(stage, { force: true }); }
  }

  function catalog() {
    return { defaultId: fixtureOptions[0].id, options: [...fixtureOptions.map(m => m.id === 'fixture-alternate' ? { ...m, imageInput: true } : m), ...groups.flatMap(g => g.models.map(m => ({
      id: m.id, label: m.label, group: { id: g.id, label: g.name },
      ...(m.imageInput && { imageInput: true }),
      ...(m.efforts.some(e => e !== 'off') && { reasoning: { defaultId: m.defaultEffort,
        levels: m.efforts.map(id => ({ id, label: effortNames[desktopEfforts.indexOf(id)] })) } }),
    }))) ] };
  }

  function list() {
    return groups.map(({ apiKey, ...group }) => ({ ...group, hasKey: !!apiKey }));
  }

  return {
    list, catalog,
    route(id) {
      for (const group of groups) {
        const model = group.models.find(m => m.id === id);
        if (model) return { apiKey: group.apiKey, provider: { ...model, name: model.label, id: model.id,
          baseUrl: group.baseUrl, api: group.api, ...(group.service === 'glm' && { service: 'glm' }) } };
      }
    },
    save({ service, model }) {
      if (!service || !model || service.id !== null && !validId(service.id) || model.id !== null && !validId(model.id) ||
          typeof service.apiKey !== 'string') throw Error('invalid_request');
      const previous = groups.find(g => g.id === service.id);
      if (service.id && !previous || model.id && !previous?.models.some(m => m.id === model.id)) throw Error('not_found');
      if ((!previous && groups.length >= 8) || (!model.id && previous?.models.length >= 7)) throw Error('limit');
      const group = checkedGroup(service, previous?.id ?? randomUUID(), service.apiKey || previous?.apiKey);
      const entry = checkedModel(group, model, model.id ?? randomUUID());
      const models = (previous?.models ?? []).map(m => m.id === model.id ? entry : checkedModel(group, m, m.id));
      const saved = { ...group, models: model.id ? models : [...models, entry] };
      persisted(previous ? groups.map(g => g.id === group.id ? saved : g) : [...groups, saved]);
      return { services: list(), models: catalog() };
    },
  };
}
