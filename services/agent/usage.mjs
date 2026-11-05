const own = (value, key) => value && typeof value === 'object' && Object.hasOwn(value, key);
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const integer = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid usage ${label}`);
  return value;
};

function rawField(raw, paths) {
  for (const path of paths) {
    let value = raw; let present = true;
    for (const key of path) {
      if (!own(value, key)) { present = false; break; }
      value = value[key];
    }
    if (present) return { present: true, value };
  }
  return { present: false };
}

/** Convert PI's normalized counters while retaining raw provider field availability. */
export function normalizeUsage(usage, raw = {}) {
  if (!usage || typeof usage !== 'object') throw new Error('Invalid usage payload');
  const inputTokens = integer(usage.input, 'input');
  const outputTokens = integer(usage.output, 'output');
  const totalTokens = integer(usage.totalTokens, 'total');
  const cacheRead = rawField(raw, [
    ['prompt_tokens_details', 'cached_tokens'], ['input_tokens_details', 'cached_tokens'],
    ['cache_read_input_tokens'], ['cached_tokens'],
  ]);
  const cacheWrite = rawField(raw, [
    ['prompt_tokens_details', 'cache_write_tokens'], ['input_tokens_details', 'cache_write_tokens'],
    ['cache_creation_input_tokens'], ['cache_write_tokens'],
  ]);
  const reasoning = rawField(raw, [
    ['completion_tokens_details', 'reasoning_tokens'], ['output_tokens_details', 'reasoning_tokens'],
    ['reasoning_tokens'],
  ]);
  const providerCost = rawField(raw, [['cost'], ['cost_details', 'total_cost']]);
  const optionalCounter = (field, fallback, label) => field.present ? integer(finite(field.value) ? field.value : fallback, label) : null;
  const providerCostUsd = providerCost.present && finite(providerCost.value) ? providerCost.value : null;
  return {
    inputTokens, outputTokens,
    cacheReadTokens: optionalCounter(cacheRead, usage.cacheRead, 'cache read'),
    cacheWriteTokens: optionalCounter(cacheWrite, usage.cacheWrite, 'cache write'),
    reasoningTokens: optionalCounter(reasoning, usage.reasoning, 'reasoning'),
    totalTokens, providerCostUsd,
  };
}

export function configuredCost(usage, pricing) {
  if (!pricing) return null;
  const parts = [
    [usage.inputTokens, pricing.inputPerMillion], [usage.outputTokens, pricing.outputPerMillion],
    [usage.cacheReadTokens, pricing.cacheReadPerMillion], [usage.cacheWriteTokens, pricing.cacheWritePerMillion],
  ];
  if (parts.some(([tokens, price]) => tokens !== null && !finite(price))) return null;
  return parts.reduce((sum, [tokens, price]) => sum + (tokens ?? 0) * (price ?? 0) / 1_000_000, 0);
}

export function summarizeUsage(rows) {
  const sum = key => rows.reduce((total, row) => total + row[key], 0);
  const complete = key => rows.length > 0 && rows.every(row => row[key] !== null);
  const cacheReadTokens = complete('cacheReadTokens') ? sum('cacheReadTokens') : null;
  const cacheWriteTokens = complete('cacheWriteTokens') ? sum('cacheWriteTokens') : null;
  const reasoningTokens = complete('reasoningTokens') ? sum('reasoningTokens') : null;
  const costUsd = complete('costUsd') ? sum('costUsd') : null;
  const inputTokens = sum('inputTokens');
  const denominator = cacheReadTokens === null ? 0 : inputTokens + cacheReadTokens;
  return {
    recordCount: rows.length, inputTokens, outputTokens: sum('outputTokens'), totalTokens: sum('totalTokens'),
    cacheReadTokens, cacheWriteTokens, reasoningTokens,
    cacheHitRate: cacheReadTokens === null || denominator === 0 ? null : cacheReadTokens / denominator,
    costUsd,
  };
}
