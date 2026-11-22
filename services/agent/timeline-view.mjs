// Public presentation fields only; never return shell arguments, code or raw tool output.
export function timelinePayload(type, input) {
  const payload = input && typeof input === 'object' ? input : {};
  if (type === 'text_delta') return typeof payload.delta === 'string' ? { delta: payload.delta } : undefined;
  if (!['tool_start', 'tool_end'].includes(type)) return undefined;
  const result = {};
  for (const key of ['toolCallId', 'toolName', 'name']) {
    if (typeof payload[key] === 'string' && payload[key].length <= 200) result[key] = payload[key];
  }
  if (typeof payload.args?.path === 'string' && payload.args.path.length <= 2048) result.args = { path: payload.args.path };
  if (type === 'tool_end') result.isError = payload.isError === true;
  if (type === 'tool_start' && (payload.toolName ?? payload.name) === 'bash' && typeof payload.args?.command === 'string') {
    // Only fixed executable/subcommand names; options, URLs, paths and values stay private.
    const match = payload.args.command.match(/^\s*(git\s+(?:status|diff|log|show|add|commit|branch|switch|checkout)|npm\s+(?:test|run|install|ci)|pnpm\s+(?:test|run|install)|(?:rg|ls|cat|sed|node|python3?|cargo|swift|xcodebuild))(?=\s|$)/);
    if (match) result.commandLabel = match[1].replace(/\s+/g, ' ');
  }
  return result;
}

// The desktop's local timeline can show simple commands. Fall back to the
// public tool name for inline scripts, shell expressions and sensitive arguments.
export function desktopCommandPreview(payload, apiKey) {
  if (payload.toolName !== 'bash' || typeof payload.args?.command !== 'string') return undefined;
  const command = payload.args.command.trim();
  const firstCommand = command.split(/[;|&\n]/, 1)[0];
  const label = timelinePayload('tool_start', { toolName: 'bash', args: { command: firstCommand } }).commandLabel;
  if (!label) return undefined;
  if (command.length > 320 || (apiKey && command.includes(apiKey)) ||
      /(?:api[-_]?key|access[-_]?key|auth|bearer|token|password|passwd|secret|credentials?|cookie|\.env\b|\.npmrc\b|\.netrc\b|\.ssh\b)/i.test(command) ||
      /(?:^|\s)-(?:c|e|E)(?:\s|$)/.test(command) ||
      (label === 'git commit' && /(?:^|\s)(?:-m|--message)(?:\s|$)/.test(command)) ||
      /\b(?:sk-|gh[pousr]_|github_pat_|AKIA)[\w-]+/i.test(command) ||
      !/^[\p{L}\p{N}_.:/@+ -]+$/u.test(command) || command.includes('://')) return label + ' …';
  return command;
}
