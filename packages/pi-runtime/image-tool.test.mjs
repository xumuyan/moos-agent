import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readdir, readFile, rm, writeFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { privateFile } from '../pi-adapter/index.mjs';
import { createImageTool, imageGenConfigPath, parseImageGenConfig } from './image-tool.mjs';
import { startMockImagesServer, MOCK_PNG } from './mock-images-server.mjs';

const PNG_BYTES = MOCK_PNG;

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'moos-image-tool-'));
  const cwd = join(root, 'project');
  const dataDir = join(root, 'data');
  await mkdir(cwd); await mkdir(dataDir);
  return { root, cwd, dataDir };
}

async function writeConfig(dataDir, value, mode) {
  await mkdir(join(dataDir, 'private'), { recursive: true, mode: 0o700 });
  if (mode === undefined) {
    await privateFile(join(dataDir, 'private', 'image-gen.json'), JSON.stringify(value));
    return;
  }
  const path = join(dataDir, 'private', 'image-gen.json');
  await writeFile(path, JSON.stringify(value), { mode });
  await chmod(path, mode);
}

test('generate_image stays unmounted until the private config exists', async t => {
  const { cwd, dataDir } = await workspace(); t.after(() => rm(join(cwd, '..'), { recursive: true, force: true }));
  assert.equal(await createImageTool({ cwd, dataDir }), null);
});

test('generate_image rejects overly permissive or unreadable config files at call time', async t => {
  const { cwd, dataDir } = await workspace(); t.after(() => rm(join(cwd, '..'), { recursive: true, force: true }));
  const mock = await startMockImagesServer(); t.after(() => mock.close());
  await writeConfig(dataDir, { baseUrl: mock.baseUrl, apiKey: 'sk-test' }, 0o644);
  const tool = await createImageTool({ cwd, dataDir });
  assert.equal(tool.name, 'generate_image');
  await assert.rejects(() => tool.execute('call_1', { prompt: '测试' }, undefined),
    /权限过宽.*chmod 600/s);
  assert.equal(mock.requests.length, 0);
  assert.deepEqual(await readdir(cwd).catch(() => []), []);
});

test('generate_image generates, saves into the workspace and reports the relative path', async t => {
  const { cwd, dataDir } = await workspace(); t.after(() => rm(join(cwd, '..'), { recursive: true, force: true }));
  const mock = await startMockImagesServer({ apiKey: 'sk-image-test' }); t.after(() => mock.close());
  mock.setPlan([{ status: 200, body: { created: 1, data: [{ b64_json: PNG_BYTES.toString('base64') }] } }]);
  await writeConfig(dataDir, { baseUrl: mock.baseUrl, apiKey: 'sk-image-test', model: 'gpt-image-2' });
  const tool = await createImageTool({ cwd, dataDir });
  const result = await tool.execute('call_1', { prompt: '蓝白极简海报/第一章' }, undefined);
  const saved = await readdir(join(cwd, 'images'));
  assert.equal(saved.length, 1);
  assert.ok(saved[0].endsWith('.png'));
  const bytes = await readFile(join(cwd, 'images', saved[0]));
  assert.deepEqual(bytes, PNG_BYTES);
  assert.match(result.content[0].text, /images[/\\]/);
  assert.equal(result.details.format, 'png');
  const request = mock.requests[0];
  assert.equal(request.url, '/v1/images/generations');
  assert.equal(request.authorization, 'Bearer sk-image-test');
  assert.equal(request.body.model, 'gpt-image-2');
  assert.equal(request.body.prompt, '蓝白极简海报/第一章');
  assert.equal(request.body.size, '1024x1024');
  assert.equal(request.body.quality, 'high');
  assert.equal(request.body.n, 1);
  const status = await lstat(join(cwd, 'images', saved[0]));
  assert.equal(status.mode & 0o777, 0o600);
});

test('generate_image applies config defaults and parameter overrides', async t => {
  const { cwd, dataDir } = await workspace(); t.after(() => rm(join(cwd, '..'), { recursive: true, force: true }));
  const mock = await startMockImagesServer({ apiKey: 'sk-test' }); t.after(() => mock.close());
  mock.setPlan([{ status: 200, body: { data: [{ b64_json: PNG_BYTES.toString('base64') }] } }]);
  await writeConfig(dataDir, { baseUrl: mock.baseUrl, apiKey: 'sk-test',
    defaults: { size: '1536x1024', quality: 'medium', output_format: 'jpeg' } });
  const tool = await createImageTool({ cwd, dataDir });
  await tool.execute('call_1', { prompt: '横幅', output_compression: 80 }, undefined);
  const saved = await readdir(join(cwd, 'images'));
  assert.ok(saved[0].endsWith('.jpeg'));
  assert.equal(mock.requests[0].body.size, '1536x1024');
  assert.equal(mock.requests[0].body.quality, 'medium');
  assert.equal(mock.requests[0].body.output_format, 'jpeg');
  assert.equal(mock.requests[0].body.output_compression, 80);
});

test('generate_image refuses invalid parameter combinations before any paid request', async t => {
  const { cwd, dataDir } = await workspace(); t.after(() => rm(join(cwd, '..'), { recursive: true, force: true }));
  const mock = await startMockImagesServer(); t.after(() => mock.close());
  await writeConfig(dataDir, { baseUrl: mock.baseUrl, apiKey: 'sk-test' });
  const tool = await createImageTool({ cwd, dataDir });
  await assert.rejects(() => tool.execute('c', { prompt: '透明', background: 'transparent', output_format: 'jpeg' }, undefined),
    /透明背景只能输出 png 或 webp/);
  await assert.rejects(() => tool.execute('c', { prompt: '压缩', output_format: 'png', output_compression: 50 }, undefined),
    /output_compression 仅适用于/);
  await assert.rejects(() => tool.execute('c', {}, undefined), /画面描述/);
  assert.equal(mock.requests.length, 0);
});

test('generate_image downloads url-only responses and bounds the file size', async t => {
  const { cwd, dataDir } = await workspace(); t.after(() => rm(join(cwd, '..'), { recursive: true, force: true }));
  const mock = await startMockImagesServer({ apiKey: 'sk-test' }); t.after(() => mock.close());
  mock.setPlan([
    { respond: (req, res) => {
      const payload = { data: [{ url: `${mock.baseUrl.replace(/\/v1$/, '')}/downloads/mock-image.png` }] };
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload));
    } },
    { respond: (req, res) => { res.writeHead(200, { 'content-type': 'image/png' }); res.end(PNG_BYTES); } },
    { status: 200, body: { data: [{ b64_json: 'A'.repeat(41 * 1024 * 1024) }] } },
  ]);
  await writeConfig(dataDir, { baseUrl: mock.baseUrl, apiKey: 'sk-test' });
  const tool = await createImageTool({ cwd, dataDir });
  const result = await tool.execute('c1', { prompt: 'url 下载' }, undefined);
  const saved = await readdir(join(cwd, 'images'));
  assert.equal(saved.length, 1);
  assert.deepEqual(await readFile(join(cwd, 'images', saved[0])), PNG_BYTES);
  assert.match(result.content[0].text, /images[/\\]/);
  await assert.rejects(() => tool.execute('c2', { prompt: '超大' }, undefined), /大小异常/);
  const overflow = await readdir(join(cwd, 'images'));
  assert.equal(overflow.length, 1, 'oversized payload must not be written');
});

for (const [status, marker] of [[401, '认证失败'], [403, '认证失败'], [429, '限流或额度不足'], [400, '服务拒绝'], [500, '暂时不可用']]) {
  test(`generate_image maps HTTP ${status} to an honest failure without writing files`, async t => {
    const { cwd, dataDir } = await workspace(); t.after(() => rm(join(cwd, '..'), { recursive: true, force: true }));
    const mock = await startMockImagesServer({ apiKey: 'sk-wrong' }); t.after(() => mock.close());
    mock.setPlan([{ status, body: { error: { message: 'private upstream detail' } } }]);
    await writeConfig(dataDir, { baseUrl: mock.baseUrl, apiKey: 'sk-wrong' });
    const tool = await createImageTool({ cwd, dataDir });
    await assert.rejects(() => tool.execute('c', { prompt: '失败场景' }, undefined), new RegExp(marker));
    assert.deepEqual(await readdir(cwd).catch(() => []), []);
  });
}

test('generate_image never retries and reports connection failures', async t => {
  const { cwd, dataDir } = await workspace(); t.after(() => rm(join(cwd, '..'), { recursive: true, force: true }));
  await writeConfig(dataDir, { baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'sk-test' });
  const tool = await createImageTool({ cwd, dataDir });
  await assert.rejects(() => tool.execute('c', { prompt: '连接失败' }, undefined), /无法连接图片服务/);
  assert.deepEqual(await readdir(cwd).catch(() => []), []);
});

test('generate_image honours cancellation signals instead of completing the request', async t => {
  const { cwd, dataDir } = await workspace(); t.after(() => rm(join(cwd, '..'), { recursive: true, force: true }));
  const mock = await startMockImagesServer({ apiKey: 'sk-test' }); t.after(() => mock.close());
  const { setTimeout: delay } = await import('node:timers/promises');
  mock.setPlan([{ respond: (req, res) => { delay(5000).then(() => res.end('{}')).catch(() => {}); } }]);
  await writeConfig(dataDir, { baseUrl: mock.baseUrl, apiKey: 'sk-test' });
  const tool = await createImageTool({ cwd, dataDir });
  const controller = new AbortController();
  const pending = tool.execute('c', { prompt: '取消场景' }, controller.signal);
  await delay(50); controller.abort();
  await assert.rejects(() => pending, { name: 'AbortError' });
  assert.deepEqual(await readdir(cwd).catch(() => []), []);
});

test('generate_image refuses read-only sessions before spending money', async t => {
  const { cwd, dataDir } = await workspace(); t.after(() => rm(join(cwd, '..'), { recursive: true, force: true }));
  const mock = await startMockImagesServer(); t.after(() => mock.close());
  await writeConfig(dataDir, { baseUrl: mock.baseUrl, apiKey: 'sk-test' });
  const tool = await createImageTool({ cwd, dataDir, getMode: () => 'read-only' });
  await assert.rejects(() => tool.execute('c', { prompt: '只读' }, undefined), /只读/);
  assert.equal(mock.requests.length, 0);
});

test('image config parsing validates keys, urls and defaults', () => {
  assert.throws(() => parseImageGenConfig('{"baseUrl": "ftp://x", "apiKey": "k"}'), /http/);
  assert.throws(() => parseImageGenConfig('{"baseUrl": "https://api.yunqiao.me/v1", "apiKey": "k\\n2"}'), /apiKey/);
  assert.throws(() => parseImageGenConfig('{"apiKey": "k"}'), /baseUrl/);
  assert.throws(() => parseImageGenConfig('not json'), /JSON/);
  assert.throws(() => parseImageGenConfig('{"baseUrl": "https://x/v1", "apiKey": "k", "defaults": {"size": "40x40"}}'), /defaults\.size/);
  const parsed = parseImageGenConfig('{"baseUrl": "https://api.yunqiao.me/v1/", "apiKey": "sk-x", "model": "gpt-image-2"}');
  assert.equal(parsed.baseUrl, 'https://api.yunqiao.me/v1');
  assert.equal(parsed.model, 'gpt-image-2');
  assert.equal(parsed.defaults.size, '1024x1024');
  const defaulted = parseImageGenConfig('{"baseUrl": "https://api.yunqiao.me/v1", "apiKey": "sk-x"}');
  assert.equal(defaulted.model, 'gpt-image-2.5-flare');
  assert.equal(imageGenConfigPath('/data'), join('/data', 'private', 'image-gen.json'));
});

test('generated filenames stay inside the images directory for hostile prompts', async t => {
  const { cwd, dataDir } = await workspace(); t.after(() => rm(join(cwd, '..'), { recursive: true, force: true }));
  const mock = await startMockImagesServer({ apiKey: 'sk-test' }); t.after(() => mock.close());
  mock.setPlan([{ status: 200, body: { data: [{ b64_json: PNG_BYTES.toString('base64') }] } }]);
  await writeConfig(dataDir, { baseUrl: mock.baseUrl, apiKey: 'sk-test' });
  const tool = await createImageTool({ cwd, dataDir });
  const result = await tool.execute('c', { prompt: '../../../etc/passwd ❌<>:"|?* 中文标题：第二章' }, undefined);
  const saved = await readdir(join(cwd, 'images'));
  assert.equal(saved.length, 1);
  assert.ok(!saved[0].includes('/'));
  assert.ok(!saved[0].includes('..'));
  assert.match(result.content[0].text, /中文标题-第二章|中文标题/);
});
