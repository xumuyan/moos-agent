import { afterEach, describe, expect, it, vi } from 'vitest';
import { request } from './api';
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe('request bridge', () => {
  it('uses native IPC with withGlobalTauri disabled and never falls back to HTTP', async () => {
    const invoke = vi.fn().mockResolvedValue({ native: true });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ http: true }) });
    vi.stubGlobal('isTauri', true);
    vi.stubGlobal('__TAURI_INTERNALS__', { invoke });
    vi.stubGlobal('fetch', fetchMock);
    expect('__TAURI__' in window).toBe(false);
    expect(await request('cancel', { taskId: 't1' })).toEqual({ native: true });
    expect(invoke).toHaveBeenCalledWith('agent_request', { method: 'cancel', params: { taskId: 't1' } }, undefined);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('propagates native failures without retrying over HTTP', async () => {
    vi.stubGlobal('isTauri', true);
    vi.stubGlobal('__TAURI_INTERNALS__', { invoke: vi.fn().mockRejectedValue(new Error('原生请求失败')) });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(request('snapshot')).rejects.toThrow('原生请求失败');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('posts JSON to the browser bridge with default params', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ projects: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    expect(await request('snapshot')).toEqual({ projects: [] });
    expect(fetchMock).toHaveBeenCalledWith('/api/snapshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  });
  it('throws the backend error on non-OK responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: '认证失败' }) }));
    await expect(request('submit')).rejects.toThrow('认证失败');
  });
});
