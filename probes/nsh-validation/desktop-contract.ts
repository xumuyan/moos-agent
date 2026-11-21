/** N01-D1 wire v1. Native retains private child pipe; TSX receives only these calls.
 * Selection is explicit projectId/sessionId on each call (no ambient mutable selection).
 */
export type Scope = { projectId: string; sessionId: string };
export type TaskRef = Scope & { taskId: string };
export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
export type Task = Scope & { id: string; status: TaskStatus; errorCode: string | null };
export type TeamGoal = Scope & {
  id: string; taskId: string; objective: string; round: number;
  status: 'queued' | 'running' | 'paused' | 'blocked' | 'completed';
  phase: 'planning' | 'working' | 'checking' | 'continuing' | 'verified';
  verifiedMembers: number; toolPreviewLimited: boolean; errorCode: string | null;
};
export type TeamGoalAction = 'start' | 'resume';
export type Project = { id: string; name: string };
type LabeledId = { id: string; label: string };
export type DesktopModel = LabeledId & { group?: LabeledId; reasoning?: { defaultId: string; levels: LabeledId[] } };
export type DesktopModelCatalog = { options: DesktopModel[]; defaultId: string };
// Optional read-only hover metadata. workspaceLabel is relative to the isolated
// Host root, not a full filesystem path or a value accepted by any request.
export type Session = { id: string; projectId: string; title: string; preview?: { workspaceLabel: string; createdAt: string } };
export type PublicEvent = { sequence: number } & (
  { type: 'text_delta'; payload: { delta: string; truncated: boolean } } |
  { type: 'task_state'; payload: { status: TaskStatus; errorCode: string | null } } |
  { type: 'tool_start'; payload: { toolCallId: string; toolName: string } } |
  { type: 'tool_end'; payload: { toolCallId: string; toolName: string; isError: boolean } }
);
// Optional task-local observations; never accumulated from chat/history text.
export type DesktopTaskStatistics = {
  toolSteps: number | null; elapsedMs: number | null; toolMs: number | null;
  cacheHitRate: number | null; context: { tokens: number; window: number } | null;
};
export type Calls = {
  'projects.list': { params: Record<string, never>; result: { projects: Project[]; models?: DesktopModelCatalog; teamGoals?: true } };
  'sessions.list': { params: { projectId: string }; result: { sessions: Session[] } };
  'sessions.create': { params: { projectId: string; title: string }; result: { session: Session } };
  // Only the trusted persistent fixture enables this historical (not live) view.
  'sessions.history': { params: Scope & { before: string | null }; result: Scope & {
    messages: { id: string; role: 'user' | 'assistant'; text: string; truncated: boolean }[]; before: string | null; teamGoal?: TeamGoal;
  } };
  'tasks.submit': { params: Scope & { requestId: string; text: string; modelId?: string; reasoningEffort?: string; teamGoal?: TeamGoalAction }; result: { task: Task; replayed: boolean; teamGoal?: TeamGoal } };
  'tasks.cancel': { params: TaskRef; result: { task: Task } };
  'tasks.events': { params: TaskRef & { cursor: string | null; limit: number }; result: {
    task: Task; terminal: boolean; events: PublicEvent[]; cursor: string; hasMore: boolean; statistics?: DesktopTaskStatistics; teamGoal?: TeamGoal;
  } };
};
export type Method = keyof Calls;
export type Request<M extends Method> = { version: 1; id: string; method: M; params: Calls[M]['params'] };
export type ErrorCode = 'invalid_request' | 'unsupported_method' | 'not_found' | 'conflict' | 'limit' |
  'invalid_cursor' | 'cursor_expired' | 'closed' | 'internal';
export type Response<M extends Method> = { version: 1; id: string | null } & (
  { ok: true; result: Calls[M]['result'] } | { ok: false; error: { code: ErrorCode } }
);

/** Transport contract for the native bridge:
 * - Spawn fixed desktop-host-stdio.mjs using an absolute trusted Node executable/script path,
 *   private pipes and a minimal environment (PATH/TMPDIR/LANG); no shell or renderer args.
 * - UTF-8 NDJSON; request <=16384 bytes excluding LF, response <=524288 bytes including LF.
 *   One write at a time, 5s blocked-write deadline. Malformed JSON/UTF-8 yields invalid_request.
 *   Oversize/truncated frames, broken output, signals and EOF close the isolated Host.
 * - IDs are per-call correlation only, not capabilities. Validate both project/session and task
 *   on EVERY scoped call. Scope IDs originate from this Host; paths/commands/credentials are not
 *   fields in this interface. The optional modelId must match the Host's public catalog; absence
 *   uses its default. The optional reasoningEffort must belong to the effective model; omission
 *   uses that model’s default (or no effort if unsupported). User text is a PI prompt, not an OS sandbox guarantee.
 * - requestId is scoped to session, at most 32 unique submissions per Host lifetime. Same text
 *   and effective model/effort replay the current task; differing values conflict. No restart replay.
 * - <=16 sessions/project; submit text <=4096 UTF-8 bytes. Events limit 1..100 and <=64KiB/page;
 *   retention <=4096 events and <=1MiB/task. cursor_expired is a gap, never silently skip it.
 * - text_delta is public model output (not reasoning), <=4096 UTF-16 units with truncated flag;
 *   tool events omit arguments/results/paths, tool IDs <=200 units and names use an allowlist.
 * - Cancel acknowledges a request; running may remain running while PI/registered tools drain.
 *   Poll until terminal && !hasMore, not terminal alone. Then stop polling. Empty nonterminal
 *   pages are not completion. Bridge must invalidate outstanding calls on child exit and use
 *   bounded pending calls/response parsing. Native/UI integration is separately unverified.
 * - Terminal drained pages may include numeric task statistics. No raw usage, provider identity,
 *   tool arguments, response payloads, or history are exposed by these observations.
 * - sessions.history is enabled only for the fixed persistent synthetic build; passes scoped
 *   message ID cursors, returns up to 12 pre-start user/assistant previews (4096 code points each).
 *   It is not a task/event replay, editing surface or import.
 * - Temporary projects/sessions disappear on clean shutdown. Failed drain retains state and
 *   exits nonzero. SDK is in-process; no separate PI child is implied. Only registered tool
 *   cleanup is tested, not arbitrary detached descendants or SIGKILL/crash recovery.
 */
