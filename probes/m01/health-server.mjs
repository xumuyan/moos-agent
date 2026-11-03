import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export function healthServer({ onProbe = () => {} } = {}) {
  return createServer((request, response) => {
    let url;
    try { url = new URL(request.url, 'http://local.invalid'); }
    catch { response.writeHead(400).end(); return; }
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'GET' || url.pathname !== '/health') {
      response.writeHead(404).end(); return;
    }
    const id = url.searchParams.get('probeId');
    if (id == null || !/^[a-zA-Z0-9-]{1,80}$/.test(id)) {
      response.writeHead(400).end(); return;
    }
    onProbe({ fromLoopback: ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress) });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ service: 'moos-m01-health', protocolVersion: 1, probeId: id }));
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = healthServer({ onProbe: event => console.log(JSON.stringify({ event: 'health-response', ...event })) });
  server.listen(43101, '0.0.0.0', () => console.log('M01 health-only server listening on port 43101; no agent/task API exposed.'));
  server.on('error', error => { console.error(error.code); process.exitCode = 1; });
  const stop = () => { server.closeAllConnections(); server.close(); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}
