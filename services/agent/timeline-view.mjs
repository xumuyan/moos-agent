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
