import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const apiKey = 'moos-local-fixture-test-only';
const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;
const nodeCommand = source => `${shellQuote(process.execPath)} -e ${shellQuote(source)}`;
const messageText = content => typeof content === 'string' ? content
  : Array.isArray(content) ? content.filter(part => part.type === 'text').map(part => part.text).join('\n') : '';

function reply(res, status, message) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { message } }));
}
function stream(res, delta, finishReason, usage = { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25,
  prompt_tokens_details: { cached_tokens: 4 }, cost: 0.00012 }) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const id = `chatcmpl-${randomUUID()}`;
  const chunk = (delta, finish_reason) => `data: ${JSON.stringify({ id, object: 'chat.completion.chunk',
    created: 0, model: 'moos-fixture', choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  res.write(chunk({ role: 'assistant' }, null));
  res.write(chunk(delta, null));
  res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 0, model: 'moos-fixture',
    choices: [{ index: 0, delta: {}, finish_reason: finishReason }], usage })}\n\n`);
  res.end('data: [DONE]\n\n');
}
function tool(res, name, args, turn) {
  stream(res, { tool_calls: [{ index: 0, id: `call_fixture_${turn}_${name}`, type: 'function',
    function: { name, arguments: JSON.stringify(args) } }] }, 'tool_calls');
}
function responsesText(res, text) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const item = { id: 'msg_fixture', type: 'message', status: 'completed', role: 'assistant',
    content: [{ type: 'output_text', text, annotations: [] }] };
  const response = { id: `resp_${randomUUID()}`, object: 'response', status: 'completed', output: [item],
    usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12, cost: 0.0002 } };
  const events = [
    { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } },
    { type: 'response.content_part.added', item_id: item.id, output_index: 0, content_index: 0,
      part: { type: 'output_text', text: '', annotations: [] } },
    { type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: text },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response },
  ];
  for (const event of events) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  res.end();
}

/** Local-only, deterministic OpenAI SSE endpoint. Never contacts a model service. */
export async function startFixture({ longDelayMs = 605000, desktopPolicy = false, onModelRequest, routingTest = false } = {}) {
  if (!Number.isSafeInteger(longDelayMs) || longDelayMs < 1 || longDelayMs > 620000) throw new Error('Invalid fixture long delay');
  const server = createServer(async (req, res) => {
    try {
      if (req.headers.authorization !== `Bearer ${apiKey}`) return reply(res, 401, 'Invalid fixture credential');
      const diagnostic = body => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.method === 'GET' && req.url === '/v1/models') return diagnostic({ data: [{ id: 'fixture' }] });
      if (req.method !== 'POST' || !['/v1/chat/completions', '/v1/responses'].includes(req.url)) return reply(res, 404, 'Unknown fixture route');
      let body = ''; let bytes = 0;
      for await (const part of req) {
        bytes += part.length;
        if (bytes > 2 * 1024 * 1024) { reply(res, 413, 'Fixture body too large'); return; }
        body += part;
      }
      let input;
      try { input = JSON.parse(body); } catch { return reply(res, 400, 'Invalid fixture JSON'); }
      onModelRequest?.(input);
      if (input.stream === false && input.model === 'fixture') {
        if (req.url === '/v1/responses' && input.input === 'Reply OK' && input.max_output_tokens === 16) {
          return diagnostic({ status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed',
            content: [{ type: 'output_text', text: 'OK' }] }] });
        }
        if (req.url === '/v1/responses' && input.input === 'Reply OK' && input.max_output_tokens === 256 &&
            input.reasoning?.effort === 'minimal') {
          return diagnostic({ status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed',
            content: [{ type: 'output_text', text: 'OK' }] }] });
        }
        if (req.url === '/v1/chat/completions' && input.max_tokens === 16 && input.messages?.length === 1 &&
            input.messages[0]?.role === 'user' && input.messages[0].content === 'Reply OK') {
          return diagnostic({ choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }] });
        }
      }
      if (req.url === '/v1/responses') {
        if (routingTest && input.stream === true && JSON.stringify(input.input).includes('MOOS_ROUTE_')) {
          if (JSON.stringify(input.input).includes('MOOS_ROUTE_BOTH')) return reply(res, 503, 'backup unavailable');
          return responsesText(res, 'Backup PI route ready');
        }
        if (input.stream === true && JSON.stringify(input.input).includes('MOOS_FIXTURE_RESPONSES')) {
          return responsesText(res, 'Responses SDK ready');
        }
        return reply(res, 400, 'Unknown fixture scenario');
      }
      if (!Array.isArray(input.messages)) return reply(res, 400, 'Fixture messages required');
      const messages = input.messages;
      const lastUser = messages.findLastIndex(message => message.role === 'user');
      if (lastUser < 0) return reply(res, 400, 'Fixture user message required');
      const text = messageText(messages[lastUser].content);
      if (routingTest && text.includes('MOOS_ROUTE_')) {
        const calls = messages.slice(lastUser + 1).filter(message => message.role === 'assistant')
          .flatMap(message => message.tool_calls ?? []);
        const errorCode = Object.entries({
          MOOS_ROUTE_QUOTA: 'insufficient_quota',
          MOOS_ROUTE_GLM_QUOTA: '1310',
          MOOS_ROUTE_GLM_MODEL: '1311',
          MOOS_ROUTE_GLM_CREDENTIAL: '1315',
        }).find(([marker]) => text.includes(marker))?.[1];
        if (errorCode) {
          res.writeHead(429, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ error: { code: errorCode, message: 'private upstream detail' } }));
        }
        if (text.includes('MOOS_ROUTE_AUTH')) return reply(res, 401, 'private upstream detail');
        if (text.includes('MOOS_ROUTE_BOTH')) return reply(res, 429, 'primary unavailable');
        if (text.includes('MOOS_ROUTE_AFTER_TOOL')) {
          return calls.length ? reply(res, 429, 'fixture rate limit')
            : tool(res, 'write', { path: 'once.txt', content: 'written once\n' }, 1);
        }
        if (text.includes('MOOS_ROUTE_REPAIR')) {
          const index = calls.length;
          if (index >= 5) return reply(res, 500, 'expected repair upgrade before another primary request');
          return index % 2 === 0
            ? tool(res, 'bash', { command: '/bin/bash test.sh' }, index + 1)
            : tool(res, 'write', { path: 'repair.txt', content: 'repair ' + index + '\n' }, index + 1);
        }
      }
      if (/\bMOOS_FIXTURE_AUTH_FAIL\b/.test(text)) return reply(res, 401, 'fixture upstream SECRET detail');
      if (/\bMOOS_FIXTURE_RATE_LIMIT\b/.test(text)) return reply(res, 429, 'fixture rate limit');
      if (desktopPolicy) {
        const original = messages.findLastIndex(message => message.role === 'user' && messageText(message.content) === 'MOOS_FIXTURE_RETRY');
        if (original >= 0 && (original === lastUser || text.startsWith('继续上一次未完成的任务。'))) {
          const results = messages.slice(original + 1).filter(message => message.role === 'tool');
          if (original === lastUser) return results.length ? reply(res, 503, 'fixture interruption after command')
            : tool(res, 'bash', { command: "printf 'once\\n' >> retry-count.txt" }, lastUser);
          if (results.length === 1) return tool(res, 'write', { path: 'retry-result.txt', content: 'resumed\n' }, lastUser);
          if (results.length === 2) return stream(res, { content: '已接续上次任务并完成剩余操作。' }, 'stop');
          return reply(res, 409, 'Expected previous tool result');
        }
      }
      if (/\bMOOS_FIXTURE_LONG\b/.test(text)) {
        await delay(longDelayMs);
        return stream(res, { content: '完成 LONG' }, 'stop');
      }
      // Match the complete marker token: never accept a safe prefix of shell/path input.
      const match = /\bMOOS_FIXTURE_WRITE\s+([^\s]+)/.exec(text);
      const hold = /\bMOOS_FIXTURE_HOLD\b/.test(text);
      const allTools = /\bMOOS_FIXTURE_TOOLS\b/.test(text);
      const policy = desktopPolicy && /\bMOOS_FIXTURE_POLICY\b/.test(text);
      const approval = desktopPolicy && /\bMOOS_FIXTURE_APPROVAL\b/.test(text);
      const image = /\bMOOS_FIXTURE_IMAGE\b/.test(text);
      const table = /\bMOOS_FIXTURE_TABLE\b/.test(text);
      const envProbe = /\bMOOS_FIXTURE_ENV\b/.test(text);
      const many = /\bMOOS_FIXTURE_MANY\b/.test(text);
      const shot = /\bMOOS_FIXTURE_SHOT\b/.test(text);
      if (match && !/^[A-Za-z0-9_]+$/.test(match[1])) return reply(res, 400, 'Invalid fixture marker');
      if ([Boolean(match), hold, allTools, policy, approval, image, table, envProbe, many, shot].filter(Boolean).length !== 1 || (text.includes('MOOS_FIXTURE_WRITE') && !match)) {
        return reply(res, 400, 'Expected one fixture scenario');
      }
      const marker = match?.[1];
      if (table) {
        // 多列长文本表格：供隔离 GUI 验收宽表格在消息卡片内滚动（无页面级横向溢出）。
        const rows = [
          '| 层 | 谁设置的 | 拦什么 | 典型现象 |',
          '| --- | --- | --- | --- |',
          '| 第 1 层：命令沙箱 | 这个 AI 软件自己加的（seatbelt 沙箱） | 我默认执行的每条命令只能在项目文件夹里活动，读你的家目录、看进程统统被拦 | 提示权限被拒绝或文件不存在 |',
          '| 第 2 层：系统 TCC | macOS 系统加的（完全磁盘访问权限） | 整个 App 都读不了桌面、下载、Library 等受保护目录 | 弹窗要求授权，或静默读不到文件 |',
          '| 第 3 层：模型服务分组 | 云桥等中转站后台配置 | 每个密钥只能调它所属分组里的模型，跨分组调用直接 403 | 聊天正常但生图报认证失败 |',
          '| 第 4 层：宿主进程隔离 | Electron 主进程与渲染进程分离 | 渲染层拿不到模型密钥明文，只能经由受限 IPC 访问 | 前端崩溃不泄漏凭据 |',
        ].join('\n');
        return stream(res, { content: `两层隔离拆开看：\n\n${rows}\n\n以上即分层拦截示意。` }, 'stop');
      }
      let sequence = ['write', 'bash'];
      if (hold) sequence = ['bash'];
      if (image) sequence = ['generate_image'];
      if (envProbe) sequence = ['bash'];
      if (many) sequence = ['bash'];
      if (shot) sequence = ['desktop_screenshot'];
      if (allTools) sequence = desktopPolicy ? ['write', 'read', 'edit', 'ls', 'bash']
        : ['write', 'read', 'edit', 'grep', 'find', 'ls', 'bash'];
      if (approval) sequence = ['bash_escalated'];
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
      if (calls.length === sequence.length) {
        if (image) {
          const resultText = results.map(result => messageText(result.content)).join('\n');
          return stream(res, { content: resultText.includes('认证失败') ? '完成 IMAGE_AUTH_REPORTED' : '完成 IMAGE' }, 'stop');
        }
        if (envProbe) {
          const resultText = results.map(result => messageText(result.content)).join('\n');
          const home = /^HOME=(.*)$/m.exec(resultText)?.[1] ?? '';
          return stream(res, { content: `完成 ENV HOME=${home}` }, 'stop');
        }
        if (many) {
          const resultText = results.map(result => messageText(result.content)).join('\n');
          const written = (resultText.match(/many-\d+\.txt/g) ?? []).length;
          return stream(res, { content: `完成 MANY ${written}` }, 'stop');
        }
        const result = hold ? 'HOLD' : allTools ? 'TOOLS' : policy ? 'POLICY' : approval ? 'APPROVAL' : shot ? 'SHOT' : marker;
        return stream(res, { content: `完成 ${result}` }, 'stop');
      }
      if (policy) {
        if (!calls.length) return tool(res, 'write', { path: 'policy.txt', content: 'inside\n' }, turn);
        return tool(res, 'bash', { command: "printf 'outside\\n' > ../moos-policy-outside.txt" }, turn);
      }
      if (approval) return tool(res, 'bash_escalated', { command: "printf 'approved\\n' > ../moos-policy-approved.txt" }, turn);
      if (envProbe) return tool(res, 'bash', { command: 'printf "HOME=%s" "$HOME"' }, turn);
      if (many) return tool(res, 'bash', { command: 'i=1; while [ "$i" -le 12 ]; do printf "many %s\\n" "$i" > "many-$i.txt"; echo "many-$i.txt written"; i=$((i+1)); done', timeout: 10 }, turn);
      if (shot) return tool(res, 'desktop_screenshot', { scope: 'display' }, turn);
      if (image) return tool(res, 'generate_image', { prompt: 'MOOS acceptance marker image', size: '1024x1024', quality: 'high' }, turn);
      if (hold) {
        if (desktopPolicy) return tool(res, 'bash', { command: 'printf "%s" "$$" > fixture-hold.pid && exec /bin/sleep 25', timeout: 30 }, turn);
        return tool(res, 'bash', { command: nodeCommand("require('node:fs').writeFileSync('fixture-hold.pid',String(process.pid)); console.log('fixture hold started'); setTimeout(()=>{console.log('fixture hold finished')},25000)"), timeout: 30 }, turn);
      }
      if (allTools) {
        const toolCases = [
          ['write', { path: 'all-tools.txt', content: 'before edit\n' }],
          ['read', { path: 'all-tools.txt' }],
          ['edit', { path: 'all-tools.txt', oldText: 'before edit', newText: 'after edit' }],
          ['grep', { pattern: 'after edit', path: '.' }],
          ['find', { pattern: 'all-tools.txt', path: '.' }],
          ['ls', { path: '.' }],
          ['bash', { command: nodeCommand("const fs=require('node:fs');if(fs.readFileSync('all-tools.txt','utf8')!=='after edit\\n')throw Error('edit missing');console.log('all tools verified')"), timeout: 5 }],
        ];
        const desktopCases = [...toolCases.slice(0, 3), toolCases[5],
          ['bash', { command: '/usr/bin/grep -qx "after edit" all-tools.txt && /usr/bin/find . -name all-tools.txt', timeout: 5 }]];
        return tool(res, ...(desktopPolicy ? desktopCases : toolCases)[calls.length], turn);
      }
      if (calls.length === 0) return tool(res, 'write', { path: 'result.txt', content: `${marker}\n` }, turn);
      const source = `const fs=require('node:fs'); const expected=${JSON.stringify(`${marker}\n`)}; if(fs.readFileSync('result.txt','utf8')!==expected) throw new Error('fixture marker mismatch'); console.log(${JSON.stringify(`verified ${marker}`)});`;
      const command = desktopPolicy ? '[ "$(/bin/cat result.txt)" = ' + shellQuote(marker) + ' ]' : nodeCommand(source);
      return tool(res, 'bash', { command, timeout: 5 }, turn);
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
