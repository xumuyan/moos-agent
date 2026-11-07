import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import DshComposer from '../../vendor/dsh/composer/DshComposer';
import TerminalDock from './TerminalDock';
import { terminalRequest } from './api';

vi.mock('./api', () => ({ nativeTerminalAvailable: () => true, terminalRequest: vi.fn() }));
vi.mock('./TerminalScreen', () => ({
  default: ({ session }: { session: { id: string } }) => <div>SCREEN:{session.id}</div>,
}));

it('places one terminal above the editor only while open and keeps its session across phases', async () => {
  const targetId = 'moos-composer-addon-panel';
  const session = { id: 'pty_1_0', projectId: 'project-a' };
  const bridge = vi.mocked(terminalRequest);
  const sessions: typeof session[] = [];
  bridge.mockImplementation(async action => {
    if (action === 'open') {
      sessions.push(session);
      return session;
    }
    if (action === 'list') return [...sessions];
    return {};
  });
  const props = {
    value: '',
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    leading: <TerminalDock projectId="project-a" panelTargetId={targetId} />,
  };
  const user = userEvent.setup();
  const view = render(<DshComposer {...props} hero />);
  const target = document.getElementById(targetId)!;
  const toggle = screen.getByRole('button', { name: '打开内置终端' });
  expect(target).toBeEmptyDOMElement();
  expect(target).not.toContainElement(toggle);
  expect(toggle).toHaveAttribute('aria-controls', targetId);

  await user.click(toggle);
  await user.click(screen.getByRole('button', { name: '新建终端' }));
  const terminal = await screen.findByText('SCREEN:pty_1_0');
  expect(target).toContainElement(terminal);

  view.rerender(<DshComposer {...props} />);
  expect(document.getElementById(targetId)).toBe(target);
  expect(screen.getByText('SCREEN:pty_1_0')).toBe(terminal);

  await user.click(screen.getByRole('button', { name: '收起内置终端' }));
  expect(target).toBeEmptyDOMElement();
  await user.click(screen.getByRole('button', { name: '打开内置终端' }));
  expect(await screen.findAllByText('SCREEN:pty_1_0')).toHaveLength(1);
  expect(bridge.mock.calls.filter(([action]) => action === 'open')).toHaveLength(1);
  expect(bridge.mock.calls.filter(([action]) => action === 'close')).toHaveLength(0);
});
