import { describe, expect, it, vi } from 'vitest';
import { executeUiCommand, uiCommands } from './commands';

describe('UI command adapter', () => {
  it('dispatches only typed Moos commands', async () => {
    const bridge = vi.fn(async () => ({ id: 'ok' }));
    await executeUiCommand(bridge, uiCommands.addProject('/work/project'));
    await executeUiCommand(bridge, uiCommands.cancelTask('task-1'));
    await executeUiCommand(bridge, uiCommands.renameConversation('p1', 'c1', '修复登录'));
    expect(bridge).toHaveBeenNthCalledWith(1, 'add_project', { path: '/work/project' });
    expect(bridge).toHaveBeenNthCalledWith(2, 'cancel', { taskId: 'task-1' });
    expect(bridge).toHaveBeenNthCalledWith(3, 'rename_conversation', { projectId: 'p1', conversationId: 'c1', title: '修复登录' });
  });

  it('rejects arbitrary methods and credential-shaped parameters at runtime', async () => {
    const bridge = vi.fn();
    await expect(executeUiCommand(bridge, { method: 'shell', params: { command: 'whoami' } } as never))
      .rejects.toThrow('Unsupported UI command');
    await expect(executeUiCommand(bridge, { method: 'submit', params: { conversationId: 'c1', message: 'x', providerId: 'p1', apiKey: 'secret' } } as never))
      .rejects.toThrow('Sensitive UI command parameter');
    expect(bridge).not.toHaveBeenCalled();
  });
});
