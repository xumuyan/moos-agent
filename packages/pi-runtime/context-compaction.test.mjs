import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPiSdk, sdkSettings, contextTokensUsed, PRE_COMPACT_MARGIN_TOKENS } from './sdk-runtime.mjs';
import { SettingsManager } from '@earendil-works/pi-coding-agent';

const SUMMARIZE_MARKER = 'conversation to summarize';
// 128k 窗口：安全线 128000-40960=87040，PI 阈值压缩线 128000-32768=95232；
// 任务 usage 90005 超安全线但低于阈值线，专门隔离出「提交前预检」路径。
const CONTEXT_WINDOW = 128000;

// PI 对「finish_reason 与 usage 同 chunk」会重复计一段文本；mock 用标准三段式：
// 内容 chunk → finish chunk → 独立 usage chunk（choices 仅含空 delta）。
function writeSse(res, { content, finish = 'stop', usage }) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  res.write('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { content }, finish_reason: null }] }) + '\n\n');
  res.write('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: {}, finish_reason: finish }] }) + '\n\n');
  res.write('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: {} }], ...(usage ? { usage } : {}) }) + '\n\n');
  res.end('data: [DONE]\n\n');
}

test('context usage math, compaction head-room, and settings reserve', () => {
  assert.equal(contextTokensUsed(undefined), 0);
  assert.equal(contextTokensUsed(null), 0);
  assert.equal(contextTokensUsed({}), 0);
  assert.equal(contextTokensUsed({ input: 407, cacheRead: 125440, cacheWrite: 0, output: 16 }), 125863);
  assert.equal(contextTokensUsed({ input: -5, cacheRead: 1.5, output: 'x', cacheWrite: 3 }), 3);
  assert.equal(PRE_COMPACT_MARGIN_TOKENS, 40960);
  const fromManager = SettingsManager.inMemory({
    compaction: { enabled: true, reserveTokens: 32768, keepRecentTokens: 20000 },
  });
  assert.equal(fromManager.getCompactionSettings({ contextWindow: 128000 }).reserveTokens, 32768);
  assert.equal(fromManager.getCompactionSettings({ contextWindow: 128000 }).keepRecentTokens, 20000);
  const settings = sdkSettings(600000);
  assert.ok(settings, 'sdkSettings builds an in-memory settings manager for a valid timeout');
});

// 三轮会话复刻生产形态：前两轮用 ~96KB 大文本建立可压缩历史（切点落在第二轮开头，
// 第一轮历史进入总结区），第三轮提交前预检发现上一轮真实 usage（90005）超过
// 窗口-40k 安全线（87040），先手动压缩成功后再提交任务本身。
test('pre-compaction runs before the prompt when the last real usage crosses the safety line', { timeout: 60000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'moos-context-compaction-'));
  await mkdir(join(root, 'shared'));
  const sequence = [];
  const server = createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const isCompact = raw.includes(SUMMARIZE_MARKER);
      sequence.push(isCompact ? 'compact' : 'task');
      writeSse(res, isCompact
        ? { content: '## Goal\nfixture compaction summary', usage: { prompt_tokens: 100, completion_tokens: 4 } }
        : { content: 'DONE', usage: { prompt_tokens: 90000, completion_tokens: 5 } });
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); server.close(); await rm(root, { recursive: true, force: true }); });
  const bigTask = 'synthetic history body '.repeat(4200);
  const run = text => runPiSdk({ task: { text, timeoutMs: 600000 },
    project: { path: join(root, 'shared') }, conversation: { id: 'shared' }, dataDir: join(root, 'sessions'),
    apiKey: 'synthetic-local-only', imageGen: null,
    provider: { id: 'fixture', name: 'Local fixture', model: 'fixture-model', api: 'openai-completions', imageInput: true,
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`, contextWindow: CONTEXT_WINDOW, maxTokens: 2048 } });
  const first = await run(bigTask);
  assert.equal(first.text, 'DONE');
  const second = await run(bigTask);
  assert.equal(second.text, 'DONE');
  assert.deepEqual(sequence, ['task', 'task'],
    'usage above the safety line but below the threshold line must not auto-compact');
  const third = await run('Third synthetic task.');
  assert.equal(third.text, 'DONE');
  assert.deepEqual(sequence, ['task', 'task', 'compact', 'task'],
    'the third task must pre-compact before its prompt because the last usage crossed the safety line');
});

// 复刻生产死锁的预检分支：前两轮大文本建立可压缩历史，第三个任务提交前预检发现上一轮
// 真实 usage 超安全线，此时压缩请求被 500 拒绝（生产中上下文满到总结请求自身也超限）——
// 预检必须以明确的 context_limit 终止，而不是继续提交一个注定超限的任务再兜底 internal。
// SDK 自身「Context overflow recovery failed...」文案的识别由 errors.test.mjs 矩阵覆盖。
test('pre-compaction failure surfaces as context_limit instead of internal', { timeout: 60000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'moos-context-fail-'));
  await mkdir(join(root, 'shared'));
  const server = createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      if (raw.includes(SUMMARIZE_MARKER)) { res.writeHead(500); res.end(); return; }
      writeSse(res, { content: 'DONE', usage: { prompt_tokens: 90000, completion_tokens: 5 } });
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); server.close(); await rm(root, { recursive: true, force: true }); });
  const bigTask = 'synthetic history body '.repeat(4200);
  const run = text => runPiSdk({ task: { text, timeoutMs: 600000 },
    project: { path: join(root, 'shared') }, conversation: { id: 'shared' }, dataDir: join(root, 'sessions'),
    apiKey: 'synthetic-local-only', imageGen: null,
    provider: { id: 'fixture', name: 'Local fixture', model: 'fixture-model', api: 'openai-completions', imageInput: true,
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`, contextWindow: CONTEXT_WINDOW, maxTokens: 2048 } });
  const first = await run(bigTask);
  assert.equal(first.text, 'DONE');
  // 第二个任务预检时只有一轮历史，压缩被本地跳过（无可压缩内容），任务照常执行。
  const second = await run(bigTask);
  assert.equal(second.text, 'DONE');
  // 第三个任务预检有完整两轮历史，压缩请求发出且被 500 拒绝：必须以 context_limit 终止。
  await assert.rejects(() => run('Third synthetic task.'),
    error => error.code === 'context_limit',
    'a failing pre-compaction must end the task as context_limit, not internal');
});
