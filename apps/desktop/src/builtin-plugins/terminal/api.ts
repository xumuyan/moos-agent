import { invoke, isTauri } from '@tauri-apps/api/core';
export interface TerminalSession { id: string; projectId: string; cwd: string; pid: number; ended: boolean; exitCode: number | null }
export interface TerminalPage { data: number[]; nextAfter: number; truncated: boolean; ended: boolean; exitCode: number | null; hasMore: boolean }
export const nativeTerminalAvailable = () => isTauri();
let tail: Promise<unknown> = Promise.resolve();
export function terminalRequest<T = unknown>(action: 'open' | 'list' | 'read' | 'write' | 'resize' | 'interrupt' | 'close' | 'close_all', params: Record<string, unknown> = {}): Promise<T> {
  if (!isTauri()) return Promise.reject(new Error('请在 Mac 桌面应用中使用内置终端'));
  const result = tail.catch(() => {}).then(() => invoke<T>('terminal_request', { action, params }));
  tail = result.catch(() => {}); return result;
}
