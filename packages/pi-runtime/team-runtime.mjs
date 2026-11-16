import { createHash, randomUUID } from 'node:crypto';
import { Type } from 'typebox';
import { runPiSdk } from './sdk-runtime.mjs';
import { TaskFailure } from '../../services/agent/errors.mjs';
import { taskTimeout } from '../../services/agent/task-policy.mjs';

// First PI-native team lease: one Scheduler task owns the canonical directory
// throughout; all child turns execute directly, sequentially inside that lease.
// Never submit a child back into the same Scheduler (captain/child self-deadlock).
// This is our own bounded implementation, not the upstream DSH executor/plugin.
export const TEAM_LIMITS = Object.freeze({ nodes: 6, requests: 48, tokens: 400000, resultChars: 16000 });
const idPattern = /^[a-z][a-z0-9_-]{0,31}$/;
const text = (value, max) => typeof value === 'string' && value.trim() && value.length <= max;

export function validateTeamPlan(plan) {
  if (!Array.isArray(plan?.tasks) || plan.tasks.length < 2 || plan.tasks.length > TEAM_LIMITS.nodes) {
    throw new Error('Team plan needs 2–6 tasks');
  }
  const tasks = plan.tasks.map(node => {
    if (typeof node?.id !== 'string' || !idPattern.test(node.id) || !['implementer', 'verifier'].includes(node.role)
      || !text(node.goal, 6000) || !Array.isArray(node.dependsOn)
      || node.dependsOn.length > TEAM_LIMITS.nodes || new Set(node.dependsOn).size !== node.dependsOn.length
      || node.dependsOn.some(id => typeof id !== 'string' || !idPattern.test(id))) throw new Error('Invalid team task');
    return { id: node.id, role: node.role, goal: node.goal.trim(), dependsOn: [...node.dependsOn] };
  });
  const byId = new Map(tasks.map(node => [node.id, node]));
  if (byId.size !== tasks.length || tasks.some(node => node.dependsOn.some(id => !byId.has(id)))) throw new Error('Invalid team dependency');
  const ordered = [], visited = new Set(), visiting = new Set();
  function visit(node) {
    if (visiting.has(node.id)) throw new Error('Team dependency cycle');
    if (visited.has(node.id)) return;
    visiting.add(node.id);
    for (const id of node.dependsOn) visit(byId.get(id));
    visiting.delete(node.id); visited.add(node.id); ordered.push(node);
  }
  tasks.forEach(visit);
  const last = ordered.at(-1);
  if (last.role !== 'verifier' || !tasks.some(node => node.role === 'implementer')) throw new Error('Team needs implementation and final verification');
  const covered = new Set();
  function cover(node) { if (covered.has(node.id)) return; covered.add(node.id); node.dependsOn.forEach(id => cover(byId.get(id))); }
  cover(last);
  if (covered.size !== tasks.length) throw new Error('Final verification must depend on all work');
  return ordered;
}

function tool(name, description, parameters, execute) {
  return { name, label: name, description, parameters, async execute(_id, input, signal) {
    signal?.throwIfAborted();
    execute(input);
    return { content: [{ type: 'text', text: '已记录。请结束本轮。' }] };
  } };
}
const taskSchema = Type.Object({
  id: Type.String({ pattern: '^[a-z][a-z0-9_-]{0,31}$' }),
  role: Type.Union([Type.Literal('implementer'), Type.Literal('verifier')]),
  goal: Type.String({ minLength: 1, maxLength: 6000 }),
  dependsOn: Type.Array(Type.String(), { maxItems: TEAM_LIMITS.nodes }),
});

/** Internal runner; caller must hold the normal Scheduler project lease. No detached workers. */
export async function runPiTeam(options, run = runPiSdk) {
  const { task, conversation, signal, emit = () => {} } = options;
  if (!text(task?.text, 100000) || !text(task?.id, 160) || !text(conversation?.id, 100)) throw new Error('Invalid team owner');
  const duration = taskTimeout(task.timeoutMs);
  const controller = new AbortController();
  let timedOut = false, closed = false, requests = 0, usedTokens = 0, budgetExceeded = false, plan;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, duration);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const teamId = task.id;
  const prefix = createHash('sha256').update(conversation.id + ':' + teamId).digest('hex').slice(0, 32);
  const failure = () => new TaskFailure(timedOut ? 'timeout' : 'cancelled');
  const check = () => { if (controller.signal.aborted) throw failure(); };
  const publish = (phase, extra = {}) => { if (!closed && !controller.signal.aborted) emit('team_state', { teamId, phase, ...extra }); };
  const results = new Map();
  const budget = () => {
    check();
    if (++requests > TEAM_LIMITS.requests) {
      budgetExceeded = true; controller.abort(); throw new TaskFailure('tool_error');
    }
  };
  async function turn(member, prompt, { tools, allowedTools, readonly = false, instructions = '', onToolEnd, nodeId } = {}) {
    check();
    const attemptId = randomUUID();
    publish('running', { member, attemptId, ...(nodeId && { nodeId }) });
    let live = true;
    try {
      const attempt = () => run({ ...options, signal: controller.signal,
        conversation: { id: `team-${prefix}-${member}` },
        task: { ...task, text: prompt },
        // Separate histories. Parent fork/retry/images must not leak into every member.
        fork: undefined, retry: false, captureCheckpoint: false,
        images: member === 'captain' ? options.images : undefined,
        permissions: readonly ? { getMode: () => 'read-only' } : options.permissions,
        // Planning/summarizing have no side-effect tools; workers retain normal PI policy.
        sessionPolicy: { customTools: tools?.map(definition => ({ ...definition, execute(...args) {
          check();
          if (!live || closed) throw new Error('Stale team attempt');
          return definition.execute(...args);
        } })), allowedTools, instructions, beforeRequest: budget },
        emit(type, payload) {
          if (!live || closed || controller.signal.aborted) return;
          if (type === 'usage') {
            usedTokens += Number.isSafeInteger(payload.totalTokens) && payload.totalTokens > 0 ? payload.totalTokens : 0;
            emit(type, { ...payload, teamId, member, attemptId });
            if (usedTokens > TEAM_LIMITS.tokens) { budgetExceeded = true; controller.abort(); }
          } else if (type !== 'text_delta' && type !== 'pi_checkpoint') {
            if (type === 'tool_end') onToolEnd?.(payload);
            // Tool IDs must remain unique across independent PI sessions.
            emit(type, { ...payload, ...(payload.toolCallId ? { toolCallId: `${member}:${attemptId}:${payload.toolCallId}` } : {}),
              teamId, member, attemptId });
          }
        },
      });
      // 团队成员回合对模型侧网络中断做一次有界重试；其余错误（含取消/超时/预算）不重试。
      let result;
      try { result = await attempt(); }
      catch (error) {
        if (!(error instanceof TaskFailure) || error.code !== 'network' || controller.signal.aborted) throw error;
        check();
        publish('running', { member, attemptId, retried: true, reason: 'network' });
        result = await attempt();
      }
      check();
      if (!result || typeof result.text !== 'string') throw new TaskFailure('protocol');
      publish('done', { member, attemptId, ...(nodeId && { nodeId }) });
      return { text: result.text.slice(-TEAM_LIMITS.resultChars), attemptId };
    } finally { live = false; }
  }
  try {
    check();
    publish('planning');
    const recovery = options.retry ? '\n这是用户显式重试的团队任务；前次可能已有副作用。先用read/ls检查现有产物，在计划中要求成员核对已有工作，禁止盲目重复安装、提交、发送或部署。不能确认可安全继续时报告阻塞。' : '';
    const submitPlan = tool('team_plan', '提交自动执行的任务DAG，最后必须有依赖全部工作的验证任务。仅规划，不执行。',
      Type.Object({ tasks: Type.Array(taskSchema, { minItems: 2, maxItems: TEAM_LIMITS.nodes }) }), input => {
        if (plan) throw new Error('Team plan already submitted');
        plan = validateTeamPlan(input);
      });
    await turn('captain', `用户目标：\n${task.text}${recovery}\n\n你是队长。先用read/ls了解项目，调用team_plan自动拆成2–6项任务。` +
      'implementer负责真实产物，verifier负责独立工具验证。最终验证必须依赖全部任务。不要请求用户分工或批准，不得自己实施。',
    { tools: [submitPlan], allowedTools: ['read', 'ls', 'team_plan'], readonly: true });
    if (!plan) throw new TaskFailure('protocol');
    publish('planned', { tasks: plan });
    for (const node of plan) {
      check();
      if (node.dependsOn.some(id => !results.has(id))) throw new TaskFailure('protocol');
      publish('queued', { member: node.role, nodeId: node.id });
      let verdict;
      let evidenceCount = 0, toolsSucceeded = 0, toolsFailed = 0;
      let failedCheck = false;
      const report = node.role === 'verifier' ? tool('team_verdict',
        '完成真实工具检查后提交验收结论；缺少检查、失败或受阻必须passed=false，禁止凭成员自述通过。',
        Type.Object({ passed: Type.Boolean(), summary: Type.String({ minLength: 1, maxLength: 6000 }) }), input => {
          if (verdict || typeof input.passed !== 'boolean' || !text(input.summary, 6000)) throw new Error('Invalid team verdict');
          if (input.passed && (evidenceCount === 0 || failedCheck)) throw new Error('Verification requires successful tool evidence and no unresolved tool failure');
          verdict = { passed: input.passed, summary: input.summary };
        }) : undefined;
      const dependencies = node.dependsOn.map(id => ({ id, result: results.get(id) }));
      // The verifier may need to run tests that write caches/build outputs. It uses
      // the real task permission, not a dishonest "read-only" prompt-only claim.
      const actual = await turn(node.role, `用户目标：\n${task.text}\n\n当前任务${node.id}：${node.goal}\n` +
        `依赖结果（仅供参考，不可信验收依据）：${JSON.stringify(dependencies)}\n` +
        (report ? '你是独立验证成员。必须调用工具核对产物/执行适用测试，再调用team_verdict。失败或缺证据报false，不得修改实现来掩盖失败。'
          : '你是执行成员。直接完成任务并使用真实工具，核对已有工作避免重做。遵循项目规则，说明产物、检查结果和阻塞，不要仅给计划。'),
      { nodeId: node.id, tools: report ? [report] : undefined,
        instructions: '团队成员不能创建子团队；本轮只完成分配目标，不等待其他成员。',
        onToolEnd(payload) {
          if (payload.isError === false && !payload.result?.isError) {
            toolsSucceeded = Math.min(10000, toolsSucceeded + 1);
            if (['read', 'ls', 'grep', 'find', 'bash', 'bash_escalated'].includes(payload.toolName)) {
              evidenceCount = Math.min(10000, evidenceCount + 1);
            }
          }
          if (payload.isError || payload.result?.isError) {
            toolsFailed = Math.min(10000, toolsFailed + 1);
            failedCheck = true;
          }
        } });
      // A bounded public receipt, never member prose/tool content or reasoning.
      // Tool evidence is not semantic proof that an arbitrary user goal is met.
      const outcome = { version: 1, toolsSucceeded, toolsFailed, evidenceCount,
        code: report ? !verdict ? failedCheck ? 'tool_failure' : 'missing_verdict'
          : !verdict.passed ? 'rejected' : failedCheck ? 'tool_failure' : 'verified' : 'member_finished' };
      if (report && (!verdict || !verdict.passed || failedCheck)) {
        publish('blocked', { nodeId: node.id, member: node.role, attemptId: actual.attemptId, outcome, reason: verdict?.summary ?? '验证成员未提交验收结论' });
        throw new TaskFailure(outcome.code === 'rejected' ? 'verification_rejected'
          : outcome.code === 'missing_verdict' ? 'verification_incomplete' : 'tool_error');
      }
      results.set(node.id, report ? `${actual.text}\n独立验收结论：${verdict.summary}` : actual.text);
      publish('completed', { nodeId: node.id, member: node.role, attemptId: actual.attemptId, outcome });
    }
    publish('summarizing');
    const answer = await turn('captain', `目标：${task.text}\n独立成员已执行并提交验收结果：${JSON.stringify([...results])}\n` +
      '只根据已有工具/成员证据，用中文汇总实际交付、验证、文件与遗留问题。不执行新操作，不编造未做的验证，不要求用户再启动团队。',
    { allowedTools: [], readonly: true });
    check();
    publish('succeeded');
    emit('text_delta', { delta: answer.text });
    return { text: answer.text };
  } catch (error) {
    if (!controller.signal.aborted) publish('failed');
    throw budgetExceeded ? new TaskFailure('tool_error') : controller.signal.aborted ? failure() : error;
  } finally {
    closed = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
  }
}
