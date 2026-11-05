export type PluginView =
  | { type: 'text'; text: string }
  | { type: 'badge'; text: string; tone?: 'neutral' | 'success' | 'warning' }
  | { type: 'button'; text: string; action: string }
  | { type: 'group'; children: PluginView[] };

export function validatePluginView(input: unknown, depth = 0, budget = { nodes: 0 }): PluginView {
  if (!input || typeof input !== 'object' || Array.isArray(input) || depth > 4 || ++budget.nodes > 64) throw new Error('Invalid plugin view');
  const value = input as Record<string, unknown>;
  if (value.type === 'group') {
    if (!Array.isArray(value.children) || value.children.length > 16) throw new Error('Invalid plugin view group');
    return { type: 'group', children: value.children.map(child => validatePluginView(child, depth + 1, budget)) };
  }
  if (!['text', 'badge', 'button'].includes(String(value.type)) || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 1000) throw new Error('Invalid plugin view leaf');
  if (value.type === 'badge') {
    if (value.tone !== undefined && !['neutral', 'success', 'warning'].includes(String(value.tone))) throw new Error('Invalid plugin badge tone');
    return { type: 'badge', text: value.text, ...(value.tone ? { tone: value.tone as 'neutral' | 'success' | 'warning' } : {}) };
  }
  if (value.type === 'button') {
    if (typeof value.action !== 'string' || !/^[a-z][a-z0-9._-]{0,63}$/.test(value.action)) throw new Error('Invalid plugin action');
    return { type: 'button', text: value.text, action: value.action };
  }
  return { type: 'text', text: value.text };
}

const CONTEXT_KEYS = new Set(['projectId', 'conversationId', 'messageId', 'role', 'taskId', 'activeTasks', 'projectName', 'section']);
export function publicPluginContext(input: unknown) {
  if (typeof input === 'string') return { section: input.slice(0, 32) };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const result: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!CONTEXT_KEYS.has(key)) continue;
    if (typeof value === 'string') result[key] = value.slice(0, 128);
    else if (typeof value === 'number' && Number.isFinite(value)) result[key] = value;
  }
  return result;
}
