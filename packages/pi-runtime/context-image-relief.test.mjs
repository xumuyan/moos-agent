import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, readdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPiSdk } from './sdk-runtime.mjs';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SUMMARIZE_MARKER = 'conversation to summarize';
// 已知 >384KB 的真实 PNG（生产形态：截图/图片原图进入 toolResult）。逐个候选探测，避免固定路径。
const PNG_CANDIDATES = [
  'node_modules/@earendil-works/pi-coding-agent/docs/images/interactive-mode.png',
  'images/muma-icon-v2/ios-appstore-1024-fullbleed.png',
  'images/moos-family-ready/muma-沐码/app-icon-square-1024.png',
];

async function findBigPng() {
  for (const candidate of PNG_CANDIDATES) {
    const target = join(REPO_ROOT, candidate);
    const info = await stat(target).catch(() => null);
    if (info?.isFile() && info.size > 384 * 1024) return target;
  }
  throw new Error('no big png fixture available');
}

function writeSse(res, { content, finish = 'stop', usage, toolCalls }) {
  const delta = toolCalls
    ? { tool_calls: toolCalls }
    : { content };
  res.write('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk',
    choices: [{ index: 0, delta, finish_reason: null }] }) + '\n\n');
  res.write('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: {}, finish_reason: finish }] }) + '\n\n');
  res.write('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: {} }], ...(usage ? { usage } : {}) }) + '\n\n');
  res.end('data: [DONE]\n\n');
}

// 端到端复刻生产徐-moss-hotal 413 死锁与自救（P03.13.21）：
// 任务 1 正常读大图（inputLimits.images.resize 压缩后进 toolResult）；
// 任务 2 提交时请求体带图 → mock 中转站回 413「request size limit」→ PI 溢出恢复压缩
// 成功但重试仍带图 → 依旧 413 → PI 放弃恢复 → sdk-runtime relief 把上下文中最大的图片
// toolResult 换成文本占位 → 重试时请求体不再含图 → mock 放行 → 任务完成。
test('request-size relief replaces the largest image and retries (P03.13.21)', { timeout: 120000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'moos-image-relief-'));
  await mkdir(join(root, 'shared'));
  const pngPath = await findBigPng();
  const pngBytes = await readFile(pngPath);

  const events = [];
  let withImageCount = 0;
  let compactCount = 0;
  const imageBase64Sizes = [];
  const server = createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      if (raw.includes(SUMMARIZE_MARKER)) {
        compactCount += 1;
        writeSse(res, { content: '## Goal\nfixture compaction summary', usage: { prompt_tokens: 100, completion_tokens: 4 } });
        return;
      }
      // openai-completions wire 格式：图片是 content 数组里的 image_url（data URL），不是内部消息的 image part。
      const hasImage = raw.includes('"type":"image_url"');
      if (hasImage) {
        withImageCount += 1;
        // 记录每次带图请求中最大的 image base64 长度（验证 model inputLimits 压缩生效）。
        const sizes = [...raw.matchAll(/data:image\/[a-z]+;base64,([A-Za-z0-9+/=]{2000,})/g)].map(m => m[1]);
        imageBase64Sizes.push(Math.max(0, ...sizes.map(s => s.length)));
      }
      if (hasImage && withImageCount >= 2) {
        // 中转站请求体超限（生产 413 文案，PI 溢出恢复与我们的 relief 都依赖它分类）。
        res.writeHead(413, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Input exceeds the context window or request size limit', type: 'invalid_request_error' } }));
        return;
      }
      if (withImageCount === 0) {
        // 任务 1：指示模型读取大图。
        writeSse(res, { finish: 'tool_calls', toolCalls: [{ index: 0, id: 'call_read_1', type: 'function',
          function: { name: 'read', arguments: JSON.stringify({ path: pngPath }) } }] });
        return;
      }
      // 不带图（首次任务请求文本确认，或 relief 清图后的重试）→ 放行。
      writeSse(res, { content: 'DONE', usage: { prompt_tokens: 8000, completion_tokens: 5 } });
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); server.close(); await rm(root, { recursive: true, force: true }); });

  const run = (text, emit) => runPiSdk({ task: { text, timeoutMs: 600000 },
    project: { path: join(root, 'shared') }, conversation: { id: 'shared' }, dataDir: join(root, 'sessions'),
    apiKey: 'synthetic-local-only', imageGen: null, emit,
    provider: { id: 'fixture', name: 'Local fixture', model: 'fixture-model', api: 'openai-completions', imageInput: true,
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`, contextWindow: 128000, maxTokens: 2048 } });

  const first = await run(`请读取文件 ${pngPath} 的内容。`);
  assert.equal(first.text, 'DONE');
  assert.equal(withImageCount, 1, 'task 1 must have submitted the image once');
  // P03.13.21 关键断言：进上下文的图已被 inputLimits.images.resize 压缩
  // （原图 519KB → base64 应显著小于原图 base64，生产默认 4.5MB 限额不会压）。
  assert.ok(imageBase64Sizes[0] > 0, 'the tool result must carry an image');
  assert.ok(imageBase64Sizes[0] < Math.round(pngBytes.length * 4 / 3 * 0.9),
    `image must be compressed: base64 ${imageBase64Sizes[0]} vs raw ${pngBytes.length}`);

  const reliefEvents = [];
  const second = await run('继续之前的任务，查看刚才那张图。', (type, payload) => { if (type === 'context_relief') reliefEvents.push(payload); });
  assert.equal(second.text, 'DONE', 'task 2 must complete after relief');
  // 413 打在前两次带图请求（任务 2 首次提交 + PI 内部可能的重试）；relief 清图后请求不再带图。
  assert.equal(withImageCount, 2, 'the 413 must have fired for image-bearing requests only');
  // PI 是否先走内部溢出恢复（compact）取决于 PI 对该文案的判定，不作为本验收面；
  // 本测试验证的是 PI 放弃后 relief 的独立兑底链路。
  assert.equal(reliefEvents.length, 1, 'exactly one context_relief event');
  assert.ok(reliefEvents[0].removedBytes > 0);

  // 会话文件里应有官方 context_edit（占位替换），而不是改动原始消息。
  const sessionDir = join(root, 'sessions', 'shared');
  const sessionFiles = [];
  const walk = async dir => {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const child = join(dir, item.name);
      if (item.isDirectory()) await walk(child);
      else if (item.name.endsWith('.jsonl')) sessionFiles.push(child);
    }
  };
  await walk(sessionDir);
  assert.ok(sessionFiles.length > 0, 'session file expected');
  const transcript = await readFile(sessionFiles.at(-1), 'utf-8');
  assert.ok(transcript.includes('"type":"context_edit"'), 'context_edit entry expected in the session file');
  assert.ok(transcript.includes('已从上下文移除以减小请求体积'), 'placeholder text expected');
});
