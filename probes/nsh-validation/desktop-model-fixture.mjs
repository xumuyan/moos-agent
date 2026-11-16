/** Desktop-only deterministic model, not a UI HTTP bridge. No external upstream.
 * Unlike the historical write/hold transport probe, accepts ordinary prompt text.
 */
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

export async function startDesktopModelFixture() {
  const apiKey = randomBytes(32).toString('hex');
  const textOf = content => typeof content === 'string' ? content : (Array.isArray(content)
    ? content.filter(p => p.type === 'text').map(p => p.text).join('\n') : '');
  const server = createServer(async (req, res) => {
    const error = status => { res.writeHead(status, { 'content-type': 'application/json' }); res.end('{"error":{"message":"Fixture rejected"}}'); };
    try {
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions' || req.headers.authorization !== `Bearer ${apiKey}`) return error(403);
      let bytes = 0; const chunks = [];
      for await (const part of req) { bytes += part.length; if (bytes > 2 * 1024 * 1024) return error(413); chunks.push(part); }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!Array.isArray(input.messages) || input.stream !== true) return error(400);
      const index = input.messages.findLastIndex(m => m.role === 'user');
      if (index < 0) return error(400);
      const text = textOf(input.messages[index].content);
      const marker = /^MOOS_FIXTURE_WRITE ([A-Za-z0-9_]{1,64})$/.exec(text)?.[1];
      const hold = text === 'MOOS_FIXTURE_HOLD';
      const calls = input.messages.slice(index + 1).filter(m => m.role === 'assistant').flatMap(m => m.tool_calls ?? []);
      const results = input.messages.slice(index + 1).filter(m => m.role === 'tool');
      const sequence = hold ? ['bash'] : marker ? ['write', 'read'] : [];
      if (calls.length > sequence.length || calls.length !== results.length || calls.some((c, i) => c.function?.name !== sequence[i] || !results.some(r => r.tool_call_id === c.id))) return error(409);
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      const chunk = (delta, finish_reason = null, usage) => res.write(`data: ${JSON.stringify({
        id: 'desktop-fixture', object: 'chat.completion.chunk', model: 'fixture', created: 0,
        choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}),
      })}\n\n`);
      chunk({ role: 'assistant' });
      if (calls.length < sequence.length) {
        const name = sequence[calls.length];
        const args = name === 'write' ? { path: 'result.txt', content: `${marker}\n` }
          : name === 'read' ? { path: 'result.txt' }
            : { command: 'printf "%s" "$$" > fixture-hold.pid && exec /bin/sleep 25', timeout: 30 };
        chunk({ tool_calls: [{ index: 0, id: `desktop_${index}_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
        chunk({}, 'tool_calls');
      } else {
        const output = marker ? `完成 ${marker}` : hold ? '完成 HOLD' : `本地夹具响应：${text.slice(0, 4096)}`;
        // Separate public deltas also exercise real PI streaming without a synthetic runner.
        for (const part of output.match(/.{1,16}/gs) ?? []) chunk({ content: part });
        chunk({}, 'stop', { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 });
      }
      res.end('data: [DONE]\n\n');
    } catch { if (!res.headersSent) error(400); else res.end(); }
  });
  server.requestTimeout = 10000; server.headersTimeout = 5000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  let closing;
  return { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey,
    close() {
      if (!closing) closing = new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
      });
      return closing;
    } };
}
