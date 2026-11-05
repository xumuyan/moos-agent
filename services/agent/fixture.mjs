import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const apiKey = 'moos-local-fixture-test-only';
const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;
const nodeCommand = source => `${shellQuote(process.execPath)} -e ${shellQuote(source)}`;
const messageText = content => typeof content === 'string' ? content
  : Array.isArray(content) ? content.filter(part => part.type === 'text').map(part => part.text).join('\n') : '';

function reply(res, status, message) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { message } }));
}
function stream(res, delta, finishReason) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const id = `chatcmpl-${randomUUID()}`;
  const chunk = (delta, finish_reason) => `data: ${JSON.stringify({ id, object: 'chat.completion.chunk',
    created: 0, model: 'moos-fixture', choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  res.write(chunk({ role: 'assistant' }, null));
  res.write(chunk(delta, null));
  res.write(chunk({}, finishReason));
  res.end('data: [DONE]\n\n');
}
function tool(res, name, args, turn) {
  stream(res, { tool_calls: [{ index: 0, id: `call_fixture_${turn}_${name}`, type: 'function',
    function: { name, arguments: JSON.stringify(args) } }] }, 'tool_calls');
}

/** Local-only, deterministic OpenAI SSE endpoint. Never contacts a model service. */
export async function startFixture() {
  const server = createServer(async (req, res) => {
    try {
      if (req.headers.authorization !== `Bearer ${apiKey}`) return reply(res, 401, 'Invalid fixture credential');
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return reply(res, 404, 'Unknown fixture route');
      let body = ''; let bytes = 0;
      for await (const part of req) {
        bytes += part.length;
        if (bytes > 2 * 1024 * 1024) { reply(res, 413, 'Fixture body too large'); return; }
        body += part;
      }
      let input;
      try { input = JSON.parse(body); } catch { return reply(res, 400, 'Invalid fixture JSON'); }
      if (!Array.isArray(input.messages)) return reply(res, 400, 'Fixture messages required');
      const messages = input.messages;
      const lastUser = messages.findLastIndex(message => message.role === 'user');
      if (lastUser < 0) return reply(res, 400, 'Fixture user message required');
      const text = messageText(messages[lastUser].content);
      // Match the complete marker token: never accept a safe prefix of shell/path input.
      const match = /\bMOOS_FIXTURE_WRITE\s+([^\s]+)/.exec(text);
      const hold = /\bMOOS_FIXTURE_HOLD\b/.test(text);
      if (match && !/^[A-Za-z0-9_]+$/.test(match[1])) return reply(res, 400, 'Invalid fixture marker');
      if ((!match && !hold) || (match && hold) || (text.includes('MOOS_FIXTURE_WRITE') && !match)) {
        return reply(res, 400, 'Expected one fixture scenario');
      }
      const marker = match?.[1];
      const sequence = hold ? ['bash'] : ['write', 'bash'];
      // Derive progress from this request, not a shared counter (projects run concurrently).
      // Only results paired with this turn's assistant calls advance the scenario.
      const turn = messages.slice(0, lastUser + 1).filter(message => message.role === 'user').length;
      const calls = messages.slice(lastUser + 1).filter(message => message.role === 'assistant').flatMap(message => message.tool_calls ?? []);
      const results = messages.slice(lastUser + 1).filter(message => message.role === 'tool');
      for (const [index, call] of calls.entries()) {
        if (call.function?.name !== sequence[index] || !results.some(result => result.tool_call_id === call.id)) {
          return reply(res, 409, 'Unexpected or unfinished fixture tool call');
        }
      }
      if (calls.length > sequence.length || results.length !== calls.length) return reply(res, 409, 'Unexpected fixture tool results');
      if (calls.length === sequence.length) return stream(res, { content: `完成 ${hold ? 'HOLD' : marker}` }, 'stop');
      if (hold) {
        return tool(res, 'bash', { command: nodeCommand("require('node:fs').writeFileSync('fixture-hold.pid',String(process.pid)); console.log('fixture hold started'); setTimeout(()=>{console.log('fixture hold finished')},25000)"), timeout: 30 }, turn);
      }
      if (calls.length === 0) return tool(res, 'write', { path: 'result.txt', content: `${marker}\n` }, turn);
      const source = `const fs=require('node:fs'); const expected=${JSON.stringify(`${marker}\n`)}; if(fs.readFileSync('result.txt','utf8')!==expected) throw new Error('fixture marker mismatch'); console.log(${JSON.stringify(`verified ${marker}`)});`;
      return tool(res, 'bash', { command: nodeCommand(source), timeout: 5 }, turn);
    } catch {
      if (!res.headersSent) reply(res, 500, 'Fixture request failed');
      else res.end();
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  let closing;
  return { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey,
    close() {
      if (!closing) closing = new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
      return closing;
    } };
}
