import test from 'node:test';
import assert from 'node:assert/strict';
import { configuredCost, normalizeUsage, summarizeUsage } from './usage.mjs';

test('normalizes PI totals while preserving whether providers reported cache and cost fields', () => {
  const known = normalizeUsage({ input: 16, output: 5, cacheRead: 4, cacheWrite: 0, totalTokens: 25 }, {
    prompt_tokens: 20, completion_tokens: 5, total_tokens: 25,
    prompt_tokens_details: { cached_tokens: 4 }, cost: 0.00012,
  });
  assert.deepEqual(known, {
    inputTokens: 16, outputTokens: 5, cacheReadTokens: 4, cacheWriteTokens: null,
    reasoningTokens: null, totalTokens: 25, providerCostUsd: 0.00012,
  });
  const missing = normalizeUsage({ input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12 }, {
    input_tokens: 10, output_tokens: 2, total_tokens: 12,
  });
  assert.equal(missing.cacheReadTokens, null);
  assert.equal(missing.providerCostUsd, null);
  assert.throws(() => normalizeUsage({ input: -1, output: 0, totalTokens: 0 }, {}), /usage/i);
});

test('summaries never estimate missing cache or cost and use the confirmed hit-rate formula', () => {
  const rows = [
    { inputTokens: 16, outputTokens: 5, cacheReadTokens: 4, cacheWriteTokens: null, reasoningTokens: null, totalTokens: 25, costUsd: 0.1 },
    { inputTokens: 8, outputTokens: 2, cacheReadTokens: 2, cacheWriteTokens: null, reasoningTokens: null, totalTokens: 12, costUsd: 0.2 },
  ];
  const complete = summarizeUsage(rows);
  assert.equal(complete.cacheHitRate, 6 / 30);
  assert.ok(Math.abs(complete.costUsd - 0.3) < Number.EPSILON);
  const incomplete = summarizeUsage([...rows,
    { inputTokens: 1, outputTokens: 1, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null, totalTokens: 2, costUsd: null },
  ]);
  assert.equal(incomplete.cacheHitRate, null);
  assert.equal(incomplete.cacheReadTokens, null);
  assert.equal(incomplete.costUsd, null);
});

test('configured prices only calculate a cost when every reported token class has a price', () => {
  const usage = { inputTokens: 1_000_000, outputTokens: 500_000, cacheReadTokens: 100_000, cacheWriteTokens: null };
  assert.equal(configuredCost(usage, {
    inputPerMillion: 1, outputPerMillion: 2, cacheReadPerMillion: 0.5,
  }), 2.05);
  assert.equal(configuredCost(usage, { inputPerMillion: 1, outputPerMillion: 2 }), null);
  assert.equal(configuredCost(usage, null), null);
});
