// Native geometry/interaction fixture only. Numbers are fabricated test inputs, not real metrics.
import { mount, signal, Text, View } from 'nsh';
import { DesktopView } from './DesktopView';
import type { Calls, Task } from './desktop-contract';
import { fixture } from './desktop-theme-fixture';
const host = fixture();
const bounds = signal<Record<string, any>>({});
const tasks = new Map<string, Task>();
let id = 0;
mount(() => <View style={{ flex: 1 }}>
  <DesktopView onGeometry={(name, value) => {
    if (JSON.stringify(bounds()[name]) !== JSON.stringify(value)) bounds.set({ ...bounds(), [name]: value });
  }} call={async (method, params) => {
    if (method === 'tasks.submit') {
      const { projectId, sessionId } = params as Calls['tasks.submit']['params'];
      const task = { id: `stats-${++id}`, projectId, sessionId, status: 'queued', errorCode: null } as const;
      tasks.set(task.id, task); return { task, replayed: false } as any;
    }
    if (method === 'tasks.events') {
      const { taskId, cursor } = params as Calls['tasks.events']['params'];
      const task = { ...tasks.get(taskId)!, status: 'succeeded' } as const;
      const first = cursor === null;
      if (!first) await new Promise(resolve => setTimeout(resolve, 1000));
      const result: Calls['tasks.events']['result'] = {
        task, terminal: true, hasMore: first, cursor: `${taskId}:${first ? 1 : 2}`,
        events: first ? [{ sequence: 1, type: 'text_delta', payload: { delta: '合成统计样本', truncated: false } }]
          : [{ sequence: 2, type: 'task_state', payload: { status: 'succeeded', errorCode: null } }],
        statistics: taskId === 'stats-1' ? { toolSteps: 2, elapsedMs: 1234, toolMs: 56, cacheHitRate: .844, context: { tokens: 86416, window: 128000 } }
          : { toolSteps: 0, elapsedMs: 0, toolMs: null, cacheHitRate: null, context: null },
      };
      return result as any;
    }
    return (host as any)[method](params).result;
  }} />
  <Text style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', fontSize: 1 }}>{'STYLE_GEOMETRY ' + JSON.stringify(bounds())}</Text>
</View>);
