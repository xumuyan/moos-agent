import { createServer } from 'node:http';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createController } from './controller.mjs';
import { runPiSdk as runPi } from '../../packages/pi-runtime/sdk-runtime.mjs';
import { startFixture } from './fixture.mjs';

if (!process.argv.includes('--fixture')) throw new Error('浏览器桥仅允许显式本地 fixture 验收；真实密钥使用 Tauri 钥匙串');
const dataDir = await mkdtemp(join(tmpdir(), 'moos-ui-fixture-'));
const fixture = await startFixture();
const controller = await createController({ dataDir, run: runPi });
await controller.request('save_provider', { provider: { id: 'local-fixture', name: '本地验收模拟模型',
  baseUrl: fixture.baseUrl, api: 'openai-completions', model: 'fixture' } });
for (const name of ['sample-a', 'sample-b']) {
  const path = join(dataDir, name);
  await mkdir(path);
  const project = await controller.request('add_project', { path });
  await controller.request('create_conversation', { projectId: project.id, title: '本地验证会话' });
}
const allowed = new Set(['snapshot', 'add_project', 'remove_project', 'create_conversation', 'submit', 'cancel', 'save_provider', 'remove_provider', 'list_models', 'test_provider']);
const server = createServer(async (request, response) => {
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  const reject = (code, message) => { response.writeHead(code); response.end(JSON.stringify({ error: message })); };
  if (request.method !== 'POST' || request.headers['content-type'] !== 'application/json' ||
      !['127.0.0.1:1420', `127.0.0.1:${server.address().port}`, 'localhost:1420'].includes(request.headers.host) ||
      (request.headers.origin && !['http://127.0.0.1:1420', 'http://localhost:1420'].includes(request.headers.origin))) {
    reject(403, '不允许的本地请求'); return;
  }
  const method = request.url?.replace(/^\/api\//, '');
  if (!allowed.has(method)) { reject(404, '请求不存在'); return; }
  try {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (Buffer.byteLength(body) > 1024 * 1024) { reject(413, '请求过大'); return; }
    }
    const params = JSON.parse(body || '{}');
    if (method === 'list_models' || method === 'test_provider') {
      if (params?.provider?.baseUrl !== fixture.baseUrl ||
          (Object.hasOwn(params, 'apiKey') && params.apiKey !== fixture.apiKey)) {
        throw new Error('浏览器验收仅允许本地 fixture 配置和测试密钥');
      }
      params.apiKey = fixture.apiKey;
    }
    if (method === 'submit') params.apiKey = fixture.apiKey;
    if (method === 'save_provider') {
      if (params.provider?.baseUrl !== fixture.baseUrl || params.apiKey) throw new Error('浏览器验收不接收真实模型配置或密钥');
    }
    const result = await controller.request(method, params);
    response.end(JSON.stringify(result));
  } catch (error) { reject(400, error.message); }
});
const port = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) ?? 4318);
await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
console.log(`Local fixture bridge ready on 127.0.0.1:${server.address().port}; temporary projects: ${dataDir}`);
let stopping;
async function stop() {
  if (stopping) return stopping;
  stopping = (async () => {
    await controller.close();
    await fixture.close();
    await new Promise(resolve => server.close(resolve));
  })();
  return stopping;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void stop().finally(() => process.exit(0)));
