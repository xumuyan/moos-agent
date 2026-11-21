/** Desktop-only deterministic model, not a UI HTTP bridge. No external upstream.
 * Unlike the historical write/hold transport probe, accepts ordinary prompt text.
 */
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

const group = Object.freeze({ id: 'local', label: '本地夹具' });
const levels = Object.freeze([Object.freeze({ id: 'low', label: 'Low' }), Object.freeze({ id: 'high', label: 'High' })]);
export const desktopFixtureModels = Object.freeze([
  Object.freeze({ id: 'fixture', label: '本地夹具 · 标准', group }),
  Object.freeze({ id: 'fixture-alternate', label: '本地夹具 · 备选', group, reasoning: Object.freeze({ defaultId: 'high', levels }) }),
]);

// Deterministic loopback acceptance for the real PI team tools. Never selects
// an external model or accepts model-supplied filesystem paths/commands.
function teamReply(text, names, calls, results) {
  const round = Number(/团队目标第 (\d+) 轮/.exec(text)?.[1]);
  if (!round) return undefined;
  const tool = (name, args) => ({ name, args });
  const latest = results.at(-1);
  if (names.has('team_plan')) {
    if (calls.length) return { content: '计划已登记' };
    return tool('team_plan', { tasks: [
      { id: 'build', role: 'implementer', goal: '写入目标结果供独立检查', dependsOn: [] },
      { id: 'check', role: 'verifier', goal: '读取结果并独立验证完整目标', dependsOn: ['build'] },
    ] });
  }
  if (names.has('team_verdict')) {
    if (!calls.length) return tool('read', { path: 'team-goal-result.txt' });
    if (calls.length > 1) return { content: '验收已登记' };
    const passed = JSON.stringify(latest).includes('goal-complete') && !text.includes('N01_GOAL_BLOCK');
    return tool('team_verdict', { passed, summary: passed ? '已读取并核对工作区结果' : '结果文件尚未满足目标' });
  }
  if (text.includes('当前任务build')) {
    if (text.includes('N01_GOAL_PAUSE') && round === 1 && !calls.length) {
      return tool('bash', { command: 'printf "%s" "$$" > fixture-goal-hold.pid && exec /bin/sleep 25', timeout: 30 });
    }
    if (!calls.length) return tool('write', { path: 'team-goal-result.txt',
      content: text.includes('N01_GOAL_REPAIR') && round === 1 ? 'repair-needed\n' : 'goal-complete\n' });
    return { content: '执行成员已处理本轮结果' };
  }
  return { content: '团队已独立验证目标结果。' };
}

export async function startDesktopModelFixture({ restartCheck = false } = {}) {
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
      const model = desktopFixtureModels.find(m => m.id === input.model);
      if (!Array.isArray(input.messages) || input.stream !== true || !model ||
          (model.reasoning ? !model.reasoning.levels.some(e => e.id === input.reasoning_effort) : input.reasoning_effort !== undefined)) return error(400);
      const index = input.messages.findLastIndex(m => m.role === 'user');
      if (index < 0) return error(400);
      const text = textOf(input.messages[index].content);
      const marker = /^MOOS_FIXTURE_WRITE ([A-Za-z0-9_]{1,64})$/.exec(text)?.[1];
      const hold = text === 'MOOS_FIXTURE_HOLD';
      const calls = input.messages.slice(index + 1).filter(m => m.role === 'assistant').flatMap(m => m.tool_calls ?? []);
      const results = input.messages.slice(index + 1).filter(m => m.role === 'tool');
      const team = teamReply(text, new Set((input.tools ?? []).map(tool => tool.function?.name)), calls, results);
      const sequence = hold ? ['bash'] : marker ? ['write', 'read'] : [];
      if (!team && (calls.length > sequence.length || calls.length !== results.length || calls.some((c, i) => c.function?.name !== sequence[i] || !results.some(r => r.tool_call_id === c.id)))) return error(409);
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      const chunk = (delta, finish_reason = null, usage) => res.write(`data: ${JSON.stringify({
        id: 'desktop-fixture', object: 'chat.completion.chunk', model: input.model, created: 0,
        choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}),
      })}\n\n`);
      chunk({ role: 'assistant' });
      if (team) {
        if (team.name) {
          chunk({ tool_calls: [{ index: 0, id: `goal_${index}_${team.name}`, type: 'function',
            function: { name: team.name, arguments: JSON.stringify(team.args) } }] });
          chunk({}, 'tool_calls');
        } else {
          chunk({ content: team.content });
          const inputTokens = text.startsWith('目标：') ? 2100000 : 20;
          chunk({}, 'stop', { prompt_tokens: inputTokens, completion_tokens: 5, total_tokens: inputTokens + 5 });
        }
      } else if (calls.length < sequence.length) {
        const name = sequence[calls.length];
        const args = name === 'write' ? { path: 'result.txt', content: `${marker}\n` }
          : name === 'read' ? { path: 'result.txt' }
            : { command: 'printf "%s" "$$" > fixture-hold.pid && exec /bin/sleep 25', timeout: 30 };
        chunk({ tool_calls: [{ index: 0, id: `desktop_${index}_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
        chunk({}, 'tool_calls');
      } else {
        const prefix = input.model === 'fixture' ? '本地夹具响应' : '本地备选夹具响应';
        const continued = restartCheck && text === 'N01_RESTART_CONTINUE';
        let output;
        if (continued) {
          const prior = input.messages.slice(0, index);
          const preserved = prior.some(m => m.role === 'user' && textOf(m.content) === 'N01_RESTART_FIRST') &&
            prior.some(m => m.role === 'assistant' && textOf(m.content) === '本地夹具响应：N01_RESTART_FIRST');
          output = preserved ? 'N01_CONTEXT_PRESERVED' : 'N01_CONTEXT_MISSING';
        } else {
          output = marker ? `完成 ${marker}` : hold ? '完成 HOLD' : `${prefix}${model.reasoning ? ` [${input.reasoning_effort}]` : ''}：${text.slice(0, 4096)}`;
        }
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
