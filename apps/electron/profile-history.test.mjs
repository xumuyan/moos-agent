import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../services/agent/store.mjs';
import { timelinePayload } from '../../services/agent/timeline-view.mjs';
import { createPiTurnReader } from './pi-turn.mjs';
import { seedHome } from './profile-home.mjs';

test('package initialization and database reopen preserve completed chat, turn mappings, actions and preferences', async t => {
  const root = await mkdtemp(join(tmpdir(), 'moos-profile-history-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'dsh');
  await mkdir(join(home, 'profiles/web'), { recursive: true });
  await mkdir(join(root, 'pi'));
  const dbPath = join(root, 'pi/moos.sqlite');
  let store = new Store({ dbPath });
  let reader;
  t.after(() => { reader?.close(); store.close(); });
  const project = await store.addProject(root);
  const conversation = store.createConversation(project.id, '保留会话名称');
  const task = store.createTask({ conversationId: conversation.id, message: '保留提问' });
  store.addMessage({ conversationId: conversation.id, taskId: task.id, role: 'user', content: '保留提问' });
  store.addMessage({ conversationId: conversation.id, taskId: task.id, role: 'assistant', content: '保留回复' });
  store.setSetting('dsh-session:retained-session', conversation.id);
  store.setSetting('dsh-turn:retained-session:12', task.id);
  store.setSetting('user-preference', JSON.stringify({ skin: 'custom', model: 'relay', effort: 'high' }));
  store.appendEvent(task.id, 'tool_start', { toolCallId: 'write-1', toolName: 'write', args: { path: 'result.txt' } });
  store.appendEvent(task.id, 'tool_end', { toolCallId: 'write-1', toolName: 'write', isError: false });
  store.updateTask(task.id, { status: 'succeeded' });
  reader = createPiTurnReader(dbPath, timelinePayload);
  const before = {
    messages: store.listMessages(conversation.id),
    conversation: store.getConversation(conversation.id),
    task: store.getTask(task.id),
    events: store.listEvents(task.id),
    turn: reader.read('retained-session', 12),
  };
  reader.close();
  store.close();
  const bytes = await readFile(dbPath);
  await seedHome(join(root, 'new-package-without-template'), home);
  assert.deepEqual(await readFile(dbPath), bytes, 'initialization must not rewrite the database');
  store = new Store({ dbPath });
  assert.equal(store.interruptUnfinished(), 0);
  reader = createPiTurnReader(dbPath, timelinePayload);
  assert.deepEqual({
    messages: store.listMessages(conversation.id),
    conversation: store.getConversation(conversation.id),
    task: store.getTask(task.id),
    events: store.listEvents(task.id),
    turn: reader.read('retained-session', 12),
  }, before);
  assert.equal(store.listTasks().length, 1, 'restart must not replay the task');
  assert.equal(store.getSetting('user-preference'), JSON.stringify({ skin: 'custom', model: 'relay', effort: 'high' }));
  assert.equal(reader.read('different-session', 12), null);
});
