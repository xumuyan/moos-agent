const messages = Object.freeze({
  auth: '模型服务认证失败，请检查 API 密钥。',
  quota: '模型服务额度不足，请检查套餐或余额。',
  rate_limit: '模型服务限流，请稍后重试。',
  network: '模型服务网络连接失败，请检查地址和网络。',
  model_capability: '当前模型或端点不支持此任务所需能力。',
  context_limit: '任务上下文超过模型限制，请缩短内容或新建会话。',
  tool_error: '本地工具执行失败，请查看任务轨迹。',
  permission: '系统或项目权限不足，请按提示授权后重试。',
  cancelled: '任务已由用户停止。',
  timeout: '任务达到设置的运行时长上限，已停止。',
  runtime_exit: '本机任务运行时意外退出。',
  host_interrupted: '应用或任务宿主中断，任务未自动重放。',
  protocol: '模型服务返回了无法识别的响应。',
  internal: '任务因内部错误失败，请使用错误码排查。',
});

export class TaskFailure extends Error {
  constructor(code) {
    if (!Object.hasOwn(messages, code)) throw new Error('Invalid task failure code');
    super(messages[code]);
    this.name = 'TaskFailure';
    this.code = code;
  }
}

export function classifyTaskError(error) {
  if (error instanceof TaskFailure) return { code: error.code, message: messages[error.code] };
  const text = String(error?.message ?? error).toLowerCase();
  let code = 'internal';
  if (/insufficient[_ -]?quota|quota exceeded|余额|额度/.test(text)) code = 'quota';
  else if (/\b401\b|\b403\b|invalid[_ -]?(api[_ -]?)?key|unauthori[sz]ed|authentication|authorization|bearer/.test(text)) code = 'auth';
  else if (/\b429\b|rate[_ -]?limit|too many requests/.test(text)) code = 'rate_limit';
  else if (/context.{0,24}(limit|length|window)|maximum context|too many tokens/.test(text)) code = 'context_limit';
  else if (/unsupported|not support|capabilit|model not found|endpoint/.test(text)) code = 'model_capability';
  else if (/permission|not permitted|access denied|operation not allowed/.test(text)) code = 'permission';
  else if (/tool.{0,24}(fail|error)|command failed|exit code/.test(text)) code = 'tool_error';
  else if (/timed? ?out|timeout|deadline/.test(text)) code = 'timeout';
  else if (/econn|enotfound|fetch failed|network|socket|connection/.test(text)) code = 'network';
  else if (/runtime|process.{0,16}(exit|closed)|host disconnected/.test(text)) code = 'runtime_exit';
  else if (/protocol|invalid response|malformed|unexpected response/.test(text)) code = 'protocol';
  return { code, message: messages[code] };
}
