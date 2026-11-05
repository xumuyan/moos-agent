import { describe, expect, it } from 'vitest';
import { createWorkspaceView } from './snapshot';
import type { Snapshot } from '../types';

const snapshot: Snapshot = {
  projects: [
    { id: 'p1', name: '项目一', path: '/work/one' },
    { id: 'p2', name: '项目二', path: '/work/two' },
  ],
  conversations: [
    { id: 'c1', projectId: 'p1', title: '当前会话' },
    { id: 'c2', projectId: 'p1', title: '后台会话' },
    { id: 'c3', projectId: 'p2', title: '另一项目' },
  ],
  messages: [],
  events: [],
  providers: [],
  tasks: [
    { id: 't1', projectId: 'p1', conversationId: 'c1', message: '当前', status: 'running' },
    { id: 't2', projectId: 'p1', conversationId: 'c2', message: '后台', status: 'queued' },
    { id: 't3', projectId: 'p2', conversationId: 'c3', message: '完成', status: 'completed' },
    { id: 't4', projectId: 'p2', conversationId: 'c3', message: '未知', status: 'future-state' },
  ],
};

describe('createWorkspaceView', () => {
  it('projects a scoped, selection-aware workspace without mutating the snapshot', () => {
    const before = structuredClone(snapshot);
    const view = createWorkspaceView(snapshot, { projectId: 'p1', conversationId: 'c1' });

    expect(view.projects).toEqual([
      expect.objectContaining({ id: 'p1', selected: true, runningTasks: 2 }),
      expect.objectContaining({ id: 'p2', selected: false, runningTasks: 0 }),
    ]);
    expect(view.conversations).toEqual([
      expect.objectContaining({ id: 'c1', selected: true, running: true }),
      expect.objectContaining({ id: 'c2', selected: false, running: true }),
    ]);
    expect(view.activeConversationTaskIds).toEqual(['t1']);
    expect(view.backgroundTaskCount).toBe(1);
    expect(snapshot).toEqual(before);
  });

  it('returns an empty safe view for stale selections', () => {
    expect(createWorkspaceView(snapshot, { projectId: 'missing', conversationId: 'missing' }))
      .toEqual(expect.objectContaining({ conversations: [], activeConversationTaskIds: [], backgroundTaskCount: 2 }));
  });
});
