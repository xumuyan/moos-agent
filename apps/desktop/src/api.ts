import { invoke, isTauri } from '@tauri-apps/api/core';

export async function request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  if (method === 'pick_directory') {
    if (!isTauri()) throw new Error('请在 Moos 桌面应用中选择项目目录');
    return invoke<T>('pick_directory');
  }
  if (isTauri()) {
    return invoke<T>('agent_request', { method, params });
  }
  const response = await fetch('/api/' + method, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `请求失败（${response.status}）`);
  return data as T;
}
