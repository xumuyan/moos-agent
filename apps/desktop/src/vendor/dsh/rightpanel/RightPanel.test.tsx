import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import RightPanel from '../../../layout/RightPanel';
import { createPluginRegistry } from '../../../plugins/registry';
import { PluginProvider } from '../../../plugins/slots';
import type { AgentEvent } from '../../../types';
import { RightPanelFrame } from './RightPanelFrame';

function change(projectId: string, path: string): AgentEvent[] {
  const scope = { taskId: `task-${projectId}`, projectId, conversationId: `chat-${projectId}` };
  return [
    { ...scope, id: `${projectId}-start`, type: 'tool_start', payload: { toolCallId: 'write', toolName: 'write', args: { path } } },
    { ...scope, id: `${projectId}-end`, type: 'tool_end', payload: { toolCallId: 'write', toolName: 'write', isError: false } },
  ];
}

test('the fixed dock updates project data and exposes the real plugin contribution with the current context', async () => {
  const user = userEvent.setup();
  const registry = createPluginRegistry();
  registry.register({ id: 'dev.moos.right-panel-fixture', name: 'Right panel fixture', version: '1.0.0', type: 'ui', moosVersion: '^0.1.0', entry: 'builtin:right-panel-fixture', slots: ['rightPanel.tab'], permissions: ['ui:slots'] }, [
    { slot: 'rightPanel.tab', render: context => <span>{(context as { projectPath?: string }).projectPath}</span> },
  ]);
  const panel = (id: string, open = true) => <PluginProvider registry={registry}>
    <RightPanelFrame.Provider value={{ width: 304, open }}>
      <RightPanel projectName={id} projectPath={`/fixture/${id}`} activeTasks={0} events={change(id, `${id}.ts`)} />
    </RightPanelFrame.Provider>
  </PluginProvider>;
  const { rerender } = render(panel('alpha'));
  expect(screen.getByText('alpha.ts')).toBeVisible();
  rerender(panel('beta'));
  expect(screen.queryByText('alpha.ts')).not.toBeInTheDocument();
  expect(screen.getByText('beta.ts')).toBeVisible();
  await user.click(screen.getByRole('tab', { name: '插件' }));
  expect(within(screen.getByRole('tabpanel')).getByText('/fixture/beta')).toBeVisible();
  expect(screen.queryByText('/fixture/alpha')).not.toBeInTheDocument();
  const dock = screen.getByRole('complementary', { name: '上下文面板' });
  expect(dock).toHaveStyle({ width: '304px' });
  rerender(panel('beta', false));
  expect(screen.queryByRole('complementary', { name: '上下文面板' })).not.toBeInTheDocument();
  expect(dock).toBeInTheDocument();
  expect(dock).not.toHaveAttribute('data-sidebar-right-open');
});
