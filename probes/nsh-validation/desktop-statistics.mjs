// Isolated Host only. Observe scheduler events without widening the public event stream.
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const duration = (from, to) => from === undefined ? null : count(to - from);
export function desktopTaskStatistics(clock = () => performance.now()) {
  let running, elapsedMs = null, toolSteps = 0, toolMs = 0, toolTimingComplete = true;
  let cacheHitRate = null, context = null;
  const tools = new Map();
  return {
    observe({ type, payload }) {
      const now = Math.round(clock());
      if (type === 'task_state') {
        if (payload.status === 'running') running = now;
        if (['succeeded', 'failed', 'cancelled', 'interrupted'].includes(payload.status)) elapsedMs = duration(running, now);
      } else if (type === 'tool_start') {
        if (tools.size < 4096 && typeof payload.toolCallId === 'string' && payload.toolCallId.length > 0 &&
          payload.toolCallId.length <= 200 && !tools.has(payload.toolCallId)) tools.set(payload.toolCallId, now);
        else toolTimingComplete = false;
      } else if (type === 'tool_end') {
        toolSteps++;
        const ms = duration(tools.get(payload.toolCallId), now);
        tools.delete(payload.toolCallId);
        if (ms === null) toolTimingComplete = false;
        else toolMs += ms;
      } else if (type === 'usage' && payload.kind !== 'compaction') {
        const total = count(payload.totalTokens), window = count(payload.contextWindow);
        const output = count(payload.outputTokens), cached = count(payload.cacheReadTokens);
        context = total !== null && window ? { tokens: total, window } : null;
        const prompt = total === null || output === null ? null : count(total - output);
        cacheHitRate = prompt && cached !== null && cached <= prompt ? cached / prompt : null;
      }
    },
    snapshot() {
      return { toolSteps: running === undefined ? null : toolSteps, elapsedMs,
        toolMs: toolSteps && toolTimingComplete && !tools.size ? toolMs : null, cacheHitRate, context };
    },
  };
}
