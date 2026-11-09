import { createServer } from 'node:http';

export const MOCK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/**
 * 本地 mock Images API（POST /v1/images/generations、GET /v1/models）。仅用于自动化测试，绝不访问真实模型服务。
 * Bearer 认证不匹配时固定返回 401；按 setPlan 队列依次响应，响应耗尽后返回 500，避免测试间互相污染。
 */
export async function startMockImagesServer({ apiKey = 'sk-image-mock-test' } = {}) {
  const requests = [];
  let plan = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', part => { body += part; });
    req.on('end', () => {
      const expected = `Bearer ${apiKey}`;
      if (req.headers.authorization !== expected) {
        requests.push({ url: req.url, authorization: req.headers.authorization, body: JSON.parse(body || '{}') });
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Invalid mock image credential' } }));
        return;
      }
      requests.push({ url: req.url, authorization: req.headers.authorization, body: JSON.parse(body || '{}') });
      if (req.method === 'GET' && (req.url === '/models' || req.url === '/v1/models')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'gpt-image-2.5-flare', object: 'model' }] }));
        return;
      }
      const next = plan.shift() ?? { status: 200, body: { created: 1, data: [{ b64_json: MOCK_PNG.toString('base64') }] } };
      if (next.respond) return next.respond(req, res, body);
      res.writeHead(next.status ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(next.body ?? {}));
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    requests, apiKey, imageBytes: MOCK_PNG,
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    setPlan(list) { plan = [...list]; },
    close() { return new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); },
  };
}
