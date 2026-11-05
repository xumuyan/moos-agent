export interface Project { id: string; name: string; path: string }
export interface Conversation { id: string; projectId: string; title: string }
export interface Message { id: string; conversationId: string; taskId?: string; role: string; content: string }
export interface Task { id: string; projectId: string; conversationId: string; message: string; status: string; error?: string; errorCode?: string; timeoutMs?: number; heartbeatAt?: string; stage?: string }
export interface AgentEvent { id: string; taskId: string; projectId: string; conversationId: string; type: string; payload: Record<string, unknown> }
export interface ProviderPricing { version: string; inputPerMillion: number; outputPerMillion: number; cacheReadPerMillion?: number; cacheWritePerMillion?: number }
export interface Provider { id: string; name: string; baseUrl: string; model: string; api: 'openai-completions' | 'openai-responses'; hasKey?: boolean; pricing?: ProviderPricing }
export interface UsageContext { conversationId: string; taskId: string; totalTokens: number; contextWindow: number | null; cacheHitRate: number | null }
export interface UsageSummary { range: string; recordCount: number; inputTokens: number; outputTokens: number; totalTokens: number; cacheReadTokens: number | null; cacheWriteTokens: number | null; reasoningTokens: number | null; cacheHitRate: number | null; costUsd: number | null; contextTokens: number | null; contextWindow: number | null }
export interface UsageExport { version: number; exportedAt: string; truncated: boolean; records: Record<string, unknown>[] }
export type HistoryCollection = 'messages' | 'tasks' | 'events';
export type HistoryCursor = string | number;
export interface HistoryPage { total: number; hasMore: boolean; before: HistoryCursor | null; requiresScopedPage: boolean; truncatedRows: { id: HistoryCursor; originalBytes: number }[] }
export type ConversationHistory = { conversationId: string } & Record<HistoryCollection, HistoryPage>;
export interface HistoryRow { collection: HistoryCollection; id: HistoryCursor; offset: number; revision: string; json: string; nextOffset: number | null; totalLength: number }
export interface RuntimeConfig { taskTimeoutMs: number; allowedTaskTimeouts: number[] }
export interface Snapshot { projects: Project[]; conversations: Conversation[]; messages: Message[]; tasks: Task[]; events: AgentEvent[]; providers: Provider[]; usageContexts?: UsageContext[]; runtime?: RuntimeConfig; history?: { version: 1; pages: ConversationHistory[]; row?: HistoryRow } }
export const emptySnapshot: Snapshot = { projects: [], conversations: [], messages: [], tasks: [], events: [], providers: [], usageContexts: [], runtime: { taskTimeoutMs: 7200000, allowedTaskTimeouts: [600000, 1800000, 3600000, 7200000, 21600000, 86400000] } };
export const isActive = (task: Task) => ['queued', 'pending', 'running', 'cancelling'].includes(task.status);
export const statusLabel = (status: string) => ({ queued: '排队中', pending: '等待中', running: '执行中', cancelling: '停止中', cancelled: '已停止', completed: '已完成', succeeded: '已完成', interrupted: '已中断', failed: '失败' }[status] ?? status);
