// Diagnostics deliberately bypass saved providers, the scheduler and task history.
const messages = {
  ok: '模型服务验证成功',
  invalid_config: '模型配置无效，请检查地址、协议和模型',
  missing_key: '请先填写或在本机设置模型密钥',
  auth: '模型密钥无效或已失效',
  forbidden: '模型服务拒绝访问，请检查密钥权限',
  model_not_found: '模型不存在或当前密钥无权使用',
  endpoint_unsupported: '模型服务不支持此接口，请检查基础地址和协议；列表不可用不代表模型不可用',
  quota: '模型服务额度不足，请检查账户额度',
  rate_limit: '模型服务请求受限，请稍后重试',
  network: '无法连接模型服务，请检查网络和服务地址',
  timeout: '模型服务响应超时，请稍后重试',
  protocol: '模型服务返回格式异常或响应过大，请检查协议配置',
};
const MAX_BYTES = 1024 * 1024;
const TIMEOUT_MS = 8000;
const upstreamCodes = new Map([
  ['invalid_api_key', 'auth'], ['authentication_error', 'auth'],
  ['permission_denied', 'forbidden'], ['permission_error', 'forbidden'],
  ['model_not_found', 'model_not_found'], ['model_not_available', 'model_not_found'],
  ['unsupported_endpoint', 'endpoint_unsupported'], ['endpoint_not_found', 'endpoint_unsupported'],
  ['insufficient_quota', 'quota'], ['quota_exceeded', 'quota'], ['billing_hard_limit_reached', 'quota'],
  ['rate_limit_exceeded', 'rate_limit'], ['rate_limit_error', 'rate_limit'],
]);
function classify(status, error) {
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  for (const value of [error?.code, error?.type]) {
    if (typeof value === 'string' && value.length <= 80 && /^[a-zA-Z0-9_]+$/.test(value)) {
      const mapped = upstreamCodes.get(value.toLowerCase());
      if (mapped) return mapped;
    }
  }
  if ([404, 405, 501].includes(status)) return 'endpoint_unsupported';
  if (status === 429) return 'rate_limit';
  return 'protocol';
}
function configuration(method, provider) {
  if (!provider || typeof provider.baseUrl !== 'string' || provider.baseUrl.length > 2048 ||
      !['openai-completions', 'openai-responses'].includes(provider.api)) return;
  const url = new URL(provider.baseUrl);
  if (url.username || url.password || url.search || url.hash ||
      !['https:', 'http:'].includes(url.protocol) ||
      (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) return;
  if (method === 'test_provider' && (typeof provider.model !== 'string' || !provider.model.trim() || provider.model.length > 200)) return;
  url.pathname = url.pathname.replace(/\/+$/, '') + (method === 'list_models' ? '/models'
    : provider.api === 'openai-completions' ? '/chat/completions' : '/responses');
  return url;
}
async function readBounded(response) {
  const declared = response.headers.get('content-length');
  if (declared && Number(declared) > MAX_BYTES) {
    await response.body?.cancel();
    throw new SyntaxError('Body limit');
  }
  const chunks = [];
  let size = 0;
  if (response.body) {
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) { await reader.cancel(); throw new SyntaxError('Body limit'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
}
function assistantText(body, api) {
  if (api === 'openai-completions') {
    return Array.isArray(body?.choices) && body.choices.some(choice =>
      choice?.message?.role === 'assistant' && typeof choice.message.content === 'string' &&
      choice.message.content.trim() && !choice.message.tool_calls?.length &&
      ['stop', 'length'].includes(choice.finish_reason));
  }
  return body?.status === 'completed' && Array.isArray(body.output) && body.output.some(item =>
    item?.type === 'message' && item.role === 'assistant' && item.status === 'completed' &&
    Array.isArray(item.content) && item.content.some(part => part?.type === 'output_text' && typeof part.text === 'string' && part.text.trim()));
}

export async function diagnoseProvider(method, params = {}) {
  const started = performance.now();
  let status;
  const finish = (code, extra = {}) => ({ ok: code === 'ok', code, message: messages[code],
    elapsedMs: Math.round(performance.now() - started), ...(status === undefined ? {} : { status }), ...extra });
  let url;
  try { url = configuration(method, params?.provider); } catch { /* Safe configuration failure. */ }
  if (!url) return finish('invalid_config');
  const apiKey = params?.apiKey;
  if (typeof apiKey !== 'string' || !apiKey.trim()) return finish('missing_key');
  if (apiKey.length > 16384 || /[\r\n\u0000]/.test(apiKey)) return finish('invalid_config');
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const provider = params.provider;
    const glmReasoning = provider.service === 'glm' && /^glm-5\.[23](?:$|[-:])/i.test(provider.model);
    const body = method === 'list_models' ? undefined : JSON.stringify(provider.api === 'openai-completions'
      ? { model: provider.model.trim(), messages: [{ role: 'user', content: 'Reply OK' }],
          max_tokens: glmReasoning ? 256 : 16, ...(glmReasoning ? { reasoning_effort: 'low' } : {}), stream: false }
      : { model: provider.model.trim(), input: 'Reply OK', max_output_tokens: 16, stream: false });
    const response = await fetch(url, { method: body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      body, redirect: 'manual', signal: abort.signal });
    status = response.status;
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      return finish('endpoint_unsupported');
    }
    let data;
    try { data = await readBounded(response); }
    catch (error) {
      if (abort.signal.aborted) return finish('timeout');
      // Status remains useful even when the provider sent an HTML error page.
      if (!response.ok) return finish(classify(response.status));
      throw error;
    }
    if (!response.ok || data?.error || (method === 'test_provider' && data?.status === 'failed')) {
      return finish(classify(response.status, data?.error));
    }
    if (method === 'list_models') {
      if (!Array.isArray(data?.data) || data.data.some(item => !item || typeof item !== 'object' || Array.isArray(item))) return finish('protocol');
      const models = [];
      const seen = new Set();
      for (const item of data.data) {
        const id = item.id;
        if (typeof id !== 'string' || !id.trim() || id.length > 200 || /[\u0000-\u001f\u007f]/.test(id) || id.includes(apiKey) || seen.has(id)) continue;
        seen.add(id); models.push(id);
        if (models.length === 500) break;
      }
      if (data.data.length && !models.length) return finish('protocol');
      return finish('ok', { models });
    }
    return finish(assistantText(data, provider.api) ? 'ok' : 'protocol');
  } catch (error) {
    return finish(abort.signal.aborted ? 'timeout' : error instanceof SyntaxError ? 'protocol' : 'network');
  } finally { clearTimeout(timer); }
}
