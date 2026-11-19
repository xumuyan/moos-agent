// Isolated native driver scene. No Node Host, PI, private data or persistent queue.
import { mount, signal, Text, View } from 'nsh';
import { Button } from 'nsh/base';
import { DesktopView } from './DesktopView';
import { fixture } from './desktop-theme-fixture';
import type { DesktopCall } from './desktop-ui-controller';
import type { Calls, TaskStatus, Task } from './desktop-contract';

const h = fixture();
const tasks = new Map<string, Task>();
const submissions = signal<Calls['tasks.submit']['params'][]>([]);
const trace = signal<string[]>([]);
const mark = (event: string) => trace.set([...trace(), event]);
let firstStatus: TaskStatus = 'running', broken = false;
let finishDrain!: () => void;
const drainGate = new Promise<void>(resolve => { finishDrain = resolve; });
const summarize = (params: Calls['tasks.submit']['params']) => [params.projectId, params.sessionId, params.text, params.modelId, params.reasoningEffort];
const call: DesktopCall = async (method, params) => {
  if (method === 'tasks.submit') {
    const p = params as Calls['tasks.submit']['params'];
    submissions.set([...submissions(), p]);
    const task: Task = { id: `task-${submissions().length}`, projectId: p.projectId, sessionId: p.sessionId, status: 'queued', errorCode: null };
    tasks.set(task.id, task); mark(`submit ${task.id}`);
    return { task, replayed: false } as any;
  }
  if (method === 'tasks.cancel') { firstStatus = 'cancelled'; mark('cancel'); return { task: tasks.get('task-1') } as any; }
  if (method === 'tasks.events') {
    const p = params as Calls['tasks.events']['params'];
    if (broken) throw Error('invalid_response');
    const task = { ...tasks.get(p.taskId)!, status: p.taskId === 'task-1' ? firstStatus : 'succeeded' as const };
    const terminal = task.status !== 'running', sequence = Number(p.cursor?.split(':')[1] ?? 0);
    const hasMore = terminal && sequence === 0 && task.id === 'task-1';
    if (hasMore) mark('terminal with backlog');
    if (terminal && !hasMore && task.id === 'task-1') {
      await drainGate;
      mark('first drained');
    }
    const events = terminal ? [{ sequence: sequence + 1, type: 'task_state', payload: { status: task.status, errorCode: null } }] : [];
    return { task, terminal, hasMore, events, cursor: `${task.id}:${sequence + events.length}` } as any;
  }
  return (h as any)[method](params).result;
};
const geometry = signal<Record<string, any>>({});
mount(() => <View style={{ flex: 1 }}>
  <DesktopView call={call} onGeometry={(name, bounds) => {
    if (JSON.stringify(geometry()[name]) !== JSON.stringify(bounds)) geometry.set({ ...geometry(), [name]: bounds });
  }} />
  <View style={{ position: 'absolute', top: 100, right: 4, flexDirection: 'row', opacity: 0, zIndex: 900 }}>
    <Button testID="fixture-success" onPress={() => { firstStatus = 'succeeded'; }} style={{ width: 24, height: 24 }}>✓</Button>
    <Button testID="fixture-drain" onPress={finishDrain} style={{ width: 24, height: 24 }}>✓</Button>
    <Button testID="fixture-fail" onPress={() => { broken = true; }} style={{ width: 24, height: 24 }}>×</Button>
  </View>
  <Text style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', fontSize: 1 }}>{'TURN_QUEUE_STATE ' + JSON.stringify({ trace: trace(), submissions: submissions().map(summarize), geometry: geometry() })}</Text>
</View>);
