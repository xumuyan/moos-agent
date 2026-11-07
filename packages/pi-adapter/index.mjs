import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, chmod, realpath, lstat } from 'node:fs/promises';
import { resolve, join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { glmRejection } from '../../services/agent/errors.mjs';

function collectUsage(incoming, queue) {
  const decoder = new StringDecoder('utf8'); let buffer = '';
  const consume = chunk => {
    buffer += chunk;
    if (buffer.length > 256 * 1024) buffer = buffer.slice(-256 * 1024);
    let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        const usage = parsed?.usage ?? (parsed?.type === 'response.completed' ? parsed?.response?.usage : undefined);
        if (usage && typeof usage === 'object' && !Array.isArray(usage)) {
          queue.push(usage); if (queue.length > 64) queue.shift();
        }
      } catch { /* Provider protocol validation remains PI's responsibility. */ }
    }
  };
  incoming.on('data', chunk => consume(decoder.write(chunk)));
  incoming.on('end', () => consume(decoder.end() + '\n'));
}

const cli = join(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))), 'cli.js');
const busy = new Set();
const BODY_LIMIT = 2 * 1024 * 1024;
export function checkedProvider(p) {
  const text = (s, n) => typeof s === 'string' && s.length > 0 && s.length <= n && !/[\x00-\x1f\x7f]/.test(s);
  if (!p || !text(p.id, 80) || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(p.id) || !text(p.name, 200) || !text(p.model, 200) || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(p.model) || !text(p.baseUrl, 2048) || !['openai-completions', 'openai-responses'].includes(p.api) || !Number.isSafeInteger(p.contextWindow) || p.contextWindow < 1 || p.contextWindow > 10000000 || !Number.isSafeInteger(p.maxTokens) || p.maxTokens < 1 || p.maxTokens > p.contextWindow) throw new Error('Invalid provider configuration');
  let url;
  try { url = new URL(p.baseUrl); } catch { throw new Error('Invalid provider URL'); }
  if (url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('Invalid provider URL: HTTPS required outside loopback');
  return url.href.replace(/\/$/, '');
}
export async function privateDir(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if ((await lstat(path)).isSymbolicLink()) throw new Error('Symlinked adapter directory');
  await chmod(path, 0o700);
}
export async function privateFile(path, text) {
  try { if ((await lstat(path)).isSymbolicLink()) throw new Error('Symlinked adapter file'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  await writeFile(path, text, { mode: 0o600 }); await chmod(path, 0o600);
}
export async function context(cwd) {
  const ancestors = []; let path = cwd;
  for (;;) { ancestors.unshift(path); const parent = dirname(path); if (parent === path) break; path = parent; }
  let instructions = 'Follow applicable AGENTS.md rules (including nested rules before editing). Read PLAN.md and operatelog.md when they exist before working. Preserve project context and report actual results only.\n';
  for (const dir of ancestors) {
    for (const name of ['AGENTS.md', 'agents.md']) {
      try { const content = await readFile(join(dir, name), 'utf8'); instructions += `\nProject instructions from ${join(dir, name)}:\n${content}\n`; break; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
  }
  if (Buffer.byteLength(instructions) > 256 * 1024) throw new Error('Project instructions exceed limit');
  return instructions;
}
export async function proxyFor(provider, baseUrl, apiKey) {
  const token = randomBytes(32).toString('hex');
  const path = provider.api === 'openai-responses' ? '/responses' : '/chat/completions';
  const upstreams = new Set();
  const usageQueue = [];
  let failure;
  const server = createServer(async (req, res) => {
    req.on('error', () => {}); res.on('error', () => {});
    const reject = status => {
      const headers = { 'content-type': 'application/json' };
      // Drain oversize uploads without resetting the connection while the client writes.
      if (status !== 413) headers.connection = 'close';
      res.writeHead(status, headers);
      res.end(JSON.stringify({ error: { message: `Proxy rejected request (${status})` } }));
      req.resume();
    };
    if (req.headers.authorization !== `Bearer ${token}`) return reject(401);
    if (req.url !== '/v1' + path || req.method !== 'POST' || req.headers.origin) return reject(404);
    if (Number(req.headers['content-length']) > BODY_LIMIT) return reject(413);
    let length = 0; const chunks = [];
    try {
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        length += chunk.length;
        if (length > BODY_LIMIT) {
          reject(413);
          return;
        }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      JSON.parse(body.toString('utf8'));
      failure = undefined;
      const target = new URL(baseUrl + path);
      const upstream = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'content-length': body.length, accept: 'text/event-stream' } });
      upstreams.add(upstream);
      res.on('close', () => upstream.destroy());
      upstream.on('close', () => upstreams.delete(upstream));
      upstream.on('error', () => {
        failure = 'network';
        if (!res.headersSent) reject(502); else res.destroy();
      });
      upstream.on('response', incoming => {
        // Never forward provider error payloads: they may echo authentication headers.
        if (incoming.statusCode < 200 || incoming.statusCode >= 300) {
          const status = incoming.statusCode;
          if (status === 429 || status === 402) {
            failure = status === 402 ? 'quota' : 'rate_limit';
            const chunks = [];
            let bytes = 0;
            let finished = false;
            const finish = () => {
              if (finished) return;
              finished = true;
              clearTimeout(timer);
              try {
                const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                if (value?.error?.code === 'insufficient_quota' || value?.error?.type === 'insufficient_quota') failure = 'quota';
                failure = glmRejection(provider.service, status, value?.error) ?? failure;
              } catch { /* Only a recognized code refines the status. */ }
              if (!res.destroyed) reject(status);
            };
            const timer = setTimeout(finish, 1000);
            incoming.on('data', chunk => {
              bytes += chunk.length;
              if (bytes <= 8192) chunks.push(chunk);
              else finish();
            });
            incoming.once('end', finish);
            incoming.once('error', finish);
            incoming.once('close', finish);
            return;
          }
          if (status === 401 || status === 403) failure = 'auth';
          else if (status >= 500 || status === 408) failure = 'network';
          incoming.resume();
          return reject(status >= 400 ? status : 502);
        }
        res.writeHead(incoming.statusCode, { 'content-type': incoming.headers['content-type'] || 'text/event-stream', 'cache-control': 'no-store' });
        incoming.on('error', () => res.destroy());
        collectUsage(incoming, usageQueue);
        incoming.pipe(res);
      });
      upstream.end(body);
    } catch { if (!res.headersSent) reject(400); else res.destroy(); }
  });
  server.requestTimeout = 30000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { token, baseUrl: `http://127.0.0.1:${server.address().port}/v1`, takeUsage: () => usageQueue.shift(),
    failure: () => failure,
    close: async () => { for (const request of upstreams) request.destroy(); server.closeAllConnections(); await new Promise(r => server.close(r)); } };
}
function processRun(child, signal, emit, message) {
  let buffer = ''; const decoder = new StringDecoder('utf8'); const pending = new Map(); let seq = 0; let text = ''; let last;
  let doneResolve, doneReject;
  const done = new Promise((resolve, reject) => { doneResolve = resolve; doneReject = reject; });
  const fail = () => { const error = new Error('PI process failed'); for (const p of pending.values()) p.reject(error); pending.clear(); doneReject(error); };
  const send = (type, data = {}) => new Promise((resolve, reject) => {
    const id = String(++seq); pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ id, type, ...data }) + '\n', e => { if (e) { pending.delete(id); reject(new Error('PI input failed')); } });
  });
  const onAbort = () => {
    // Responses are still consumed while the bounded shutdown runs in finally.
    void send('clear_queue').catch(() => {}); void send('abort').catch(() => {});
    const error = new Error('PI task aborted'); error.name = 'AbortError';
    for (const p of pending.values()) p.reject(error); pending.clear(); doneReject(error);
  };
  child.stdout.on('data', chunk => {
    buffer += decoder.write(chunk);
    if (buffer.length > 16 * 1024 * 1024) return fail();
    let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event.type === 'response') {
          const waiter = pending.get(event.id); pending.delete(event.id);
          if (waiter) event.success ? waiter.resolve(event.data) : waiter.reject(new Error(`PI command failed: ${event.command}`));
        } else if (event.type === 'message_update') {
          if (event.assistantMessageEvent?.type === 'text_delta') { const delta = event.assistantMessageEvent.delta; text += delta; emit('text_delta', { delta }); }
        } else if (event.type === 'message_end' && event.message?.role === 'assistant') {
          last = event.message; if (last.usage) emit('usage', last.usage);
        } else if (event.type === 'tool_execution_start') {
          const { toolCallId, toolName, args } = event; emit('tool_start', { toolCallId, toolName, args });
        } else if (event.type === 'tool_execution_update') {
          const { toolCallId, partialResult } = event; emit('tool_update', { toolCallId, partialResult });
        } else if (event.type === 'tool_execution_end') {
          const { toolCallId, toolName, result, isError } = event; emit('tool_end', { toolCallId, toolName, result, isError });
        } else if (event.type === 'agent_settled') {
          if (event.aborted || signal.aborted || last?.stopReason === 'aborted') doneReject(new Error('PI task aborted'));
          else if (!last || last.stopReason !== 'stop') doneReject(new Error('PI model failed to finish successfully'));
          else doneResolve({ text });
        }
      } catch { fail(); }
    }
  });
  child.on('error', fail); child.on('exit', fail); child.stdin.on('error', () => {}); child.stderr.resume();
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) onAbort();
  const drive = async () => {
    await send('get_state');
    await send('set_auto_retry', { enabled: false });
    if (signal.aborted) throw new Error('PI task aborted');
    const response = await send('prompt', { message });
    if (response?.disposition === 'handled') throw new Error('PI prompt handled without agent run');
  };
  void drive().catch(doneReject);
  return done.finally(() => signal.removeEventListener('abort', onAbort));
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(r => child.once('exit', r));
  const wait = ms => { let timer; return Promise.race([exited.then(() => true), new Promise(r => { timer = setTimeout(() => r(false), ms); })]).finally(() => clearTimeout(timer)); };
  child.stdin.end();
  if (await wait(700)) return;
  child.kill('SIGTERM');
  if (await wait(700)) return;
  child.kill('SIGKILL'); await exited;
}

/** Run one real PI RPC task. task.text is required; task.timeoutMs is bounded to ten minutes. */
export async function runPi({ task, project, conversation, signal, emit = () => {}, provider, dataDir, apiKey }) {
  const upstream = checkedProvider(provider);
  if (!conversation || typeof conversation.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(conversation.id)) throw new Error('Invalid conversation id');
  const message = typeof task === 'string' ? task : task?.text;
  const duration = typeof task === 'object' && task.timeoutMs !== undefined ? task.timeoutMs : 600000;
  if (typeof message !== 'string' || !message.trim() || Buffer.byteLength(message) > 1024 * 1024 || !Number.isInteger(duration) || duration < 1 || duration > 600000) throw new Error('Invalid task or timeout');
  if (typeof apiKey !== 'string' || !apiKey || apiKey.length > 16384 || /[\r\n\x00]/.test(apiKey)) throw new Error('Invalid API key');
  if (!project || !isAbsolute(project.path) || !isAbsolute(dataDir)) throw new Error('Absolute project and dataDir required');
  const cwd = await realpath(project.path);
  const root = resolve(dataDir, conversation.id);
  if (busy.has(root) || busy.has(cwd)) throw new Error('Project or conversation already running');
  busy.add(root); busy.add(cwd);
  const controller = new AbortController(); const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  const timer = setTimeout(abort, duration);
  let proxy, child;
  try {
    if (controller.signal.aborted) throw new Error('PI task aborted');
    await privateDir(dataDir); await privateDir(root);
    const agent = join(root, 'agent'); const home = join(root, 'home');
    await privateDir(agent); await privateDir(home);
    const session = join(root, 'session.jsonl');
    let existing;
    try { existing = await lstat(session); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (existing) {
      if (existing.isSymbolicLink()) throw new Error('Symlinked session');
      try {
        const header = JSON.parse((await readFile(session, 'utf8')).split('\n')[0]);
        if (header.type !== 'session' || await realpath(header.cwd) !== cwd) throw new Error('mismatch');
      } catch { throw new Error('Session cwd does not match project'); }
      await chmod(session, 0o600);
    }
    const instructions = await context(cwd);
    proxy = await proxyFor(provider, upstream, apiKey);
    await privateFile(join(agent, 'models.json'), JSON.stringify({ providers: { [provider.id]: { baseUrl: proxy.baseUrl, api: provider.api, apiKey: proxy.token, authHeader: true, models: [{ id: provider.model, name: provider.name, reasoning: false, input: ['text'], contextWindow: provider.contextWindow, maxTokens: provider.maxTokens, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
    await privateFile(join(agent, 'settings.json'), JSON.stringify({ enableTerminalImages: false }));
    if (controller.signal.aborted) throw new Error('PI task aborted');
    child = spawn(process.execPath, [cli, '--mode', 'rpc', '--provider', provider.id, '--model', provider.model, '--session', session, '--no-extensions', '--no-mcp', '--no-skills', '--no-prompt-templates', '--no-themes', '--offline', '--no-approve', '--tools', 'read,write,edit,bash,grep,find,ls', '--append-system-prompt', instructions], {
      cwd, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin', HOME: home, PI_CODING_AGENT_DIR: agent, PI_OFFLINE: '1', LANG: 'en_US.UTF-8' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    // The host owns these children; graceful host exit cannot leave them alive.
    const onExit = () => child.kill('SIGKILL'); process.once('exit', onExit);
    try { return await processRun(child, controller.signal, emit, message); }
    finally { await stop(child); process.removeListener('exit', onExit); }
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
    if (proxy) await proxy.close();
    busy.delete(root); busy.delete(cwd);
  }
}
