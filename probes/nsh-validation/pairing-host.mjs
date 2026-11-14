/** N01 loopback-only HTTPS pairing lifecycle, deliberately NOT a PI/task server. */
import { createServer } from 'node:https';
import { X509Certificate, createHash } from 'node:crypto';
import { createPairingAuthority, PairingError } from './pairing.mjs';
export async function startPairingHost({ tls, ...options } = {}) {
  if (!tls?.key || !tls?.cert || !tls?.ca) throw new Error('Explicit disposable TLS identity required');
  const leaf = new X509Certificate(tls.cert), ca = new X509Certificate(tls.ca);
  if (!ca.ca || !leaf.verify(ca.publicKey) || !leaf.checkIP('127.0.0.1')) throw new Error('Invalid disposable TLS chain');
  const sha = cert => createHash('sha256').update(cert.raw).digest('hex');
  let authority, budget = 64, closed = false, closing;
  async function request(req) {
    if (closed || !authority) throw new PairingError(503);
    if (budget-- <= 0) throw new PairingError(429); // Lifetime cap, no unbounded public pairing attempts.
    if (req.headers.origin || req.headers['sec-fetch-site'] === 'cross-site') throw new PairingError(403);
    if (req.method === 'POST' && ['/v1/pairing/claim', '/v1/pairing/redeem'].includes(req.url)) {
      if (req.headers.authorization) throw new PairingError(400);
      if (req.headers['content-type'] !== 'application/json') throw new PairingError(415);
      if (Number(req.headers['content-length']) > 4096) throw new PairingError(413);
      let length = 0; const chunks = [];
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        length += chunk.length; if (length > 4096) throw new PairingError(413); chunks.push(chunk);
      }
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new PairingError(400); }
      return req.url.endsWith('/claim') ? authority.claim(input) : authority.redeem(input);
    }
    const match = /^\/v1\/projects\/([a-z0-9_-]{1,64})\/check$/.exec(req.url);
    if (req.method === 'GET' && match) {
      const bearer = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization ?? '');
      const principal = authority.authenticate(bearer?.[1], match[1]);
      return { version: 1, project: principal.project, authorized: true };
    }
    throw new PairingError(404);
  }
  const server = createServer({ key: tls.key, cert: tls.cert, minVersion: 'TLSv1.2' }, (req, res) => {
    req.on('error', () => {}); res.on('error', () => {});
    const send = (status, value) => {
      if (res.destroyed) return;
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store',
        'x-content-type-options': 'nosniff', connection: 'close' });
      res.end(JSON.stringify(value)); req.resume();
    };
    void request(req).then(value => send(200, value), error => send(error instanceof PairingError ? error.status : 500,
      { version: 1, error: 'Pairing request rejected' }));
  });
  server.requestTimeout = 10000; server.headersTimeout = 5000; server.maxHeadersCount = 32;
  try {
    await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
    const endpoint = `https://127.0.0.1:${server.address().port}`;
    // The certificate fingerprints are derived locally, never supplied by an HTTP peer.
    authority = createPairingAuthority({ ...options, endpoint, caSHA256: sha(ca), leafSHA256: sha(leaf) });
    return { endpoint, address: server.address(),
      invite: () => authority.invite(), pending: () => authority.pending(),
      confirm: input => authority.confirm(input), deny: id => authority.deny(id), revoke: id => authority.revoke(id),
      close() {
        if (!closing) {
          closed = true; authority.close();
          closing = new Promise(done => server.close(done)); server.closeAllConnections();
        }
        return closing;
      }
    };
  } catch (error) { authority?.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); throw error; }
}
