import type { DesktopModel, DesktopModelCatalog } from './desktop-contract';

export type ModelChoice = { modelId: string; reasoningEffort?: string };
const token = (s: unknown) => typeof s === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(s);
const label = (s: unknown) => typeof s === 'string' && s.length <= 80 && !!s.trim() && !/[\x00-\x1f\x7f]/.test(s);

// Copy only public presentation data, never pass catalog records back to the Host.
export function modelCatalog(value: unknown): DesktopModelCatalog {
  const v = value as Partial<DesktopModelCatalog> | null;
  const invalid = (): never => { throw Error('invalid_response'); };
  if (!v || !Array.isArray(v.options) || !v.options.length || v.options.length > 64) return invalid();
  const options = Array.from(v.options, (m): DesktopModel => {
    if (!m || !token(m.id) || !label(m.label)) return invalid();
    const model: DesktopModel = { id: m.id, label: m.label };
    if (m.group !== undefined) {
      if (!m.group || !token(m.group.id) || !label(m.group.label)) return invalid();
      model.group = { id: m.group.id, label: m.group.label };
    }
    if (m.reasoning !== undefined) {
      const r = m.reasoning;
      if (!r || !Array.isArray(r.levels) || !r.levels.length || r.levels.length > 12) return invalid();
      const levels = Array.from(r.levels, e => {
        if (!e || !token(e.id) || !label(e.label)) return invalid();
        return { id: e.id, label: e.label };
      });
      const ids = new Set(levels.map(e => e.id));
      if (ids.size !== levels.length || !ids.has(r.defaultId)) return invalid();
      model.reasoning = { defaultId: r.defaultId, levels };
    }
    return model;
  });
  const ids = new Set(options.map(m => m.id));
  if (ids.size !== options.length || !v.defaultId || !ids.has(v.defaultId)) return invalid();
  const groups = new Map<string, string>();
  for (const m of options) if (m.group) {
    if (groups.has(m.group.id) && groups.get(m.group.id) !== m.group.label) return invalid();
    groups.set(m.group.id, m.group.label);
  }
  return { options, defaultId: v.defaultId };
}

export function defaultChoice(model: DesktopModel): ModelChoice {
  return { modelId: model.id, ...(model.reasoning && { reasoningEffort: model.reasoning.defaultId }) };
}

// Keep provider/site order. Within each group put prefixes first, then prefer
// closer ordered-subsequence matches; an empty search preserves catalog order.
export function modelGroups(models: DesktopModel[], text: string) {
  const q = text.trim().toLowerCase();
  const groups = new Map<string, { id: string; label: string; matches: { model: DesktopModel; score: number }[] }>();
  for (const model of models) {
    const id = model.group?.id ?? '';
    if (!groups.has(id)) groups.set(id, { id, label: model.group?.label ?? '', matches: [] });
    const name = model.label.toLowerCase();
    let score = 0, pos = -1, matched = true;
    if (!name.startsWith(q)) {
      score = 1;
      for (const c of q) {
        const next = name.indexOf(c, pos + 1);
        if (next === -1) { matched = false; break; }
        score += next - pos - 1;
        pos = next + c.length - 1;
      }
    }
    if (matched) groups.get(id)!.matches.push({ model, score });
  }
  return [...groups.values()].filter(g => g.matches.length).map(g => ({ id: g.id, label: g.label,
    models: g.matches.sort((a, b) => a.score - b.score).map(match => match.model) }));
}
