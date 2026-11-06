import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { request } from '../api';
import { useTaskTimeline } from './useTaskTimeline';
import type { AgentEvent, Task, TaskTimelinePage } from '../types';
vi.mock('../api', () => ({ request: vi.fn() }));
const bridge = vi.mocked(request);
const task: Task = { id: 't', projectId: 'p', conversationId: 'c', message: 'task', status: 'running', updatedAt: 'one' };
const event = (id: number, owner = 't'): AgentEvent => ({ id: String(id), taskId: owner, projectId: 'p', conversationId: 'c', type: 'text_delta', payload: { delta: `text-${id}` } });
const page = (events: AgentEvent[], nextAfter: number, hasMore = false, owner = 't'): { taskTimeline: TaskTimelinePage } => ({ taskTimeline: { version: 1, taskId: owner, projectId: 'p', conversationId: 'c', events, nextAfter, hasMore, limited: false } });
beforeEach(() => bridge.mockReset());
it('retains more than 50 events and incrementally loads new ones without duplicate snapshots', async () => {
  bridge.mockResolvedValueOnce(page(Array.from({ length: 200 }, (_, i) => event(i + 1)), 200, true))
    .mockResolvedValueOnce(page([event(201)], 201)).mockResolvedValueOnce(page([event(202)], 202));
  const { result, rerender } = renderHook(({ owner }) => useTaskTimeline(owner, [event(201)], true), { initialProps: { owner: task } });
  await waitFor(() => expect(result.current.events).toHaveLength(201));
  expect(result.current.events[0].id).toBe('1');
  rerender({ owner: { ...task, updatedAt: 'two' } });
  await waitFor(() => expect(result.current.events).toHaveLength(202));
  expect(bridge).toHaveBeenLastCalledWith('snapshot', { conversationId: 'c', taskTimeline: { taskId: 't', after: 201 } });
});
it('ignores late results when changing tasks and excludes foreign snapshot events', async () => {
  let resolve!: (value: unknown) => void;
  bridge.mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValueOnce(page([event(5, 'other')], 5, false, 'other'));
  const { result, rerender } = renderHook(({ owner }) => useTaskTimeline(owner, [event(1)], true), { initialProps: { owner: task } });
  await waitFor(() => expect(bridge).toHaveBeenCalledTimes(1));
  rerender({ owner: { ...task, id: 'other' } });
  await act(async () => resolve(page([event(1)], 1)));
  await waitFor(() => expect(result.current.events).toHaveLength(1));
  expect(result.current.events[0].taskId).toBe('other');
  expect(result.current.events.map(row => row.taskId)).toEqual(['other']);
});
it('serializes history requests from multiple mounted turns and releases after errors', async () => {
  let active = 0, peak = 0;
  bridge.mockImplementation(async (_method, params) => {
    if (!params?.taskTimeline) return {};
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    const id = (params?.taskTimeline as { taskId: string }).taskId;
    if (id === 'first') throw new Error('unavailable');
    return page([event(1, id)], 1, false, id);
  });
  const { result } = renderHook(() => [
    useTaskTimeline({ ...task, id: 'first' }, [], true),
    useTaskTimeline({ ...task, id: 'second' }, [], true),
    useTaskTimeline({ ...task, id: 'third' }, [], true),
  ]);
  await waitFor(() => expect(result.current.every(row => !row.busy)).toBe(true));
  expect(peak).toBe(1);
  expect(result.current[0].error).not.toBe('');
  expect(result.current[1].events).toHaveLength(1);
  expect(result.current[2].events).toHaveLength(1);
});
it('bounds invalid non-advancing pages and retries without leaking raw errors', async () => {
  bridge.mockResolvedValueOnce(page([], 0, true)).mockResolvedValueOnce(page([event(1)], 1));
  const { result } = renderHook(() => useTaskTimeline(task, [], true));
  await waitFor(() => expect(result.current.error).toBe('完整过程加载失败，可重试。'));
  expect(bridge).toHaveBeenCalledTimes(1);
  act(() => result.current.load());
  await waitFor(() => expect(result.current.events).toHaveLength(1));
  expect(result.current.error).toBe('');
});
it('loads on request when not automatic and rejects a cross-project page', async () => {
  bridge.mockResolvedValue({ taskTimeline: { ...page([event(1)], 1).taskTimeline, projectId: 'foreign' } });
  const { result } = renderHook(() => useTaskTimeline(task, [], false));
  expect(bridge).not.toHaveBeenCalled();
  act(() => result.current.load());
  await waitFor(() => expect(result.current.error).not.toBe(''));
  expect(result.current.events).toHaveLength(0);
});
it('stops a page batch at 32 requests and continues only when requested', async () => {
  bridge.mockImplementation(async (_method, params) => {
    if (!params?.taskTimeline) return {};
    const after = (params.taskTimeline as { after: number }).after;
    return page([event(after + 1)], after + 1, after + 1 < 35);
  });
  const { result } = renderHook(() => useTaskTimeline(task, [], true));
  await waitFor(() => { expect(bridge.mock.calls.filter(([, params]) => params?.taskTimeline)).toHaveLength(32); expect(result.current.busy).toBe(false); });
  expect(result.current.events).toHaveLength(32);
  expect(result.current.hasMore).toBe(true);
  act(() => result.current.load());
  await waitFor(() => expect(result.current.events).toHaveLength(35));
  expect(result.current.hasMore).toBe(false);
});
