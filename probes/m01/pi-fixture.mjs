import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PiRpc } from './pi-rpc.mjs';

export async function createFixture({ node = process.execPath,
  cli = resolve('node_modules/@earendil-works/pi-coding-agent/dist/cli.js') } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'moos-m01-'));
  const configDir = join(root, 'config');
  const cwd = join(root, 'project');
  await mkdir(configDir); await mkdir(cwd);
  await writeFile(join(cwd, 'fixture.txt'), 'M01_READ_OK\n');
  let requests = 0;
  const server = createServer(async (request, response) => {
    if (request.url !== '/v1/chat/completions' || request.method !== 'POST') {
      response.writeHead(404).end(); return;
    }
    let raw = '';
    for await (const chunk of request) {
      raw += chunk;
      if (raw.length > 1024 * 1024) { response.writeHead(413).end(); return; }
    }
    const body = JSON.parse(raw); requests++;
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const emit = (delta, finish = null) => response.write(`data: ${JSON.stringify({
      id: 'm01-local', object: 'chat.completion.chunk', created: 1, model: 'fixture',
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`);
    const lastUser = body.messages.findLast(message => message.role === 'user');
    if (JSON.stringify(lastUser?.content).includes('M01_HOLD')) {
      emit({ role: 'assistant', content: 'waiting' });
      // Intentionally hold this stream until abort closes the connection.
      return;
    }
    const hasResult = body.messages.some(message => message.role === 'tool');
    if (!hasResult) {
      emit({ role: 'assistant', tool_calls: [{ index: 0, id: 'm01-read', type: 'function',
        function: { name: 'read', arguments: JSON.stringify({ path: 'fixture.txt' }) } }] });
      emit({}, 'tool_calls');
    } else {
      emit({ role: 'assistant', content: 'M01_' });
      emit({ content: 'DONE' });
      emit({}, 'stop');
    }
    response.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await writeFile(join(configDir, 'models.json'), JSON.stringify({ providers: {
    m01: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      api: 'openai-completions', apiKey: 'local-fixture-not-a-credential',
      models: [{ id: 'fixture', name: 'M01 local fixture', input: ['text'],
        contextWindow: 32000, maxTokens: 1000,
        compat: { supportsDeveloperRole: false, supportsStore: false, supportsReasoningEffort: false } }] },
  } }));
  const rpc = new PiRpc({ node, cli, cwd, configDir });
  return { rpc, root, requestCount: () => requests,
    async close() {
      await rpc.close();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await rm(root, { recursive: true, force: true });
    } };
}
